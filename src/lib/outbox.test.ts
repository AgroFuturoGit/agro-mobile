import { ApiError, apiRequest, OfflineError } from "@/lib/api";
import {
  type Attachment,
  discardAttachmentFile,
  uploadAttachment,
} from "@/lib/attachments";
import {
  clearOutbox,
  enqueue,
  discardEntry,
  flushOutbox,
  getOutbox,
  MAX_SERVER_ATTEMPTS,
  type OutboxEntry,
  retryEntry,
  setConflictReconciler,
  streamKeyOf,
} from "@/lib/outbox";

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, apiRequest: jest.fn() };
});

// A fila decide se envia agora consultando a conectividade. Nos testes ela é
// fixada em "online" — quem controla o resultado é o mock do `apiRequest`.
// O upload de anexo é nativo (`expo-file-system`), inexistente sob o Jest.
// O que se verifica aqui é o contrato da fila com ele: quando chama, e quando
// manda apagar o arquivo.
jest.mock("@/lib/attachments", () => ({
  uploadAttachment: jest.fn(),
  discardAttachmentFile: jest.fn(),
}));

jest.mock("@/lib/net", () => ({
  getConnectivity: () => ({
    isConnected: true,
    isInternetReachable: true,
    type: "wifi",
  }),
  isProbablyOnline: () => true,
}));

const mockedRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockedUpload = uploadAttachment as jest.MockedFunction<
  typeof uploadAttachment
>;
const mockedDiscard = discardAttachmentFile as jest.MockedFunction<
  typeof discardAttachmentFile
>;

type QueueInput = Parameters<typeof enqueue>[0];

function executionCreate(planId: string, label = `ap ${planId}`): QueueInput {
  return {
    kind: "execution.create",
    method: "POST",
    path: `/production-plans/${planId}/executions`,
    body: { actualYield: 10, harvestDate: "2026-08-01" },
    label,
    meta: { planId },
    invalidates: [`executions:plan:${planId}`],
  };
}

function planCreate(localId: string, farmerId = "prod-1"): QueueInput {
  return {
    id: localId,
    kind: "plan.create",
    method: "POST",
    path: `/farmers/${farmerId}/production-plans`,
    body: { cropId: "c1", harvestId: "h1", plantedArea: 2, expectedYield: 100 },
    label: "Novo plano",
    snapshot: { id: localId, plantedArea: 2 },
    meta: { farmerId },
    invalidates: [`plans:farmer:${farmerId}`],
  };
}

function planUpdate(planId: string, farmerId = "prod-1"): QueueInput {
  return {
    kind: "plan.update",
    method: "PUT",
    path: `/production-plans/${planId}`,
    body: { plantedArea: 3, expectedYield: 120 },
    label: "Editar plano",
    snapshot: { id: planId, plantedArea: 3 },
    meta: { farmerId, planId },
    invalidates: [`plans:farmer:${farmerId}`, `plan:${planId}`],
  };
}

function byLabel(label: string): OutboxEntry | undefined {
  return getOutbox().find((entry) => entry.label === label);
}

/** Caminhos chamados na API, na ordem. */
function calledPaths(): string[] {
  return mockedRequest.mock.calls.map((call) => call[0]);
}

beforeEach(async () => {
  // Esvaziar a fila antes de zerar os mocks: `clearOutbox` apaga o arquivo de
  // cada anexo pendente, e essas chamadas são da limpeza do teste anterior —
  // não do teste que está começando.
  await clearOutbox();
  mockedRequest.mockReset();
  mockedUpload.mockReset();
  mockedDiscard.mockReset();
});

describe("streamKeyOf", () => {
  it("agrupa plano e seus apontamentos no mesmo recurso", async () => {
    const plan = await enqueue(planUpdate("plan-1"));
    const execution = await enqueue(executionCreate("plan-1"));

    expect(streamKeyOf(plan)).toBe(streamKeyOf(execution));
  });

  it("usa o id do próprio item quando o plano ainda não existe na API", async () => {
    const created = await enqueue(planCreate("local-9"));

    // `plan.create` não tem `meta.planId`: o id provisório do plano é o do item.
    expect(streamKeyOf(created)).toBe("plan:local-9");
  });

  it("separa recursos diferentes", async () => {
    const a = await enqueue(executionCreate("plan-a"));
    const b = await enqueue(executionCreate("plan-b"));

    expect(streamKeyOf(a)).not.toBe(streamKeyOf(b));
  });
});

describe("flushOutbox", () => {
  it("envia a fila em ordem e a esvazia", async () => {
    mockedRequest.mockResolvedValue({ id: "ok" });

    await enqueue(executionCreate("plan-1", "primeiro"));
    await enqueue(executionCreate("plan-1", "segundo"));

    const result = await flushOutbox();

    expect(result).toEqual({
      outcome: "synced",
      sent: 2,
      failed: 0,
      conflicted: 0,
      remaining: 0,
    });
    expect(getOutbox()).toHaveLength(0);
  });

  it("mantém a ordem de criação dentro do mesmo recurso", async () => {
    mockedRequest.mockResolvedValue({ id: "real-1" });

    await enqueue(planCreate("local-1"));
    await enqueue(planUpdate("local-1"));

    await flushOutbox();

    expect(calledPaths()).toEqual([
      "/farmers/prod-1/production-plans",
      "/production-plans/real-1",
    ]);
  });

  it("não envia nada quando a fila está vazia", async () => {
    const result = await flushOutbox();

    expect(result.outcome).toBe("synced");
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe("isolamento entre recursos", () => {
  /**
   * A regressão que motivou o agrupamento por recurso: a fila era um único
   * lote serial, então um 5xx no primeiro item impedia todo o resto de subir —
   * inclusive apontamentos de planos que não tinham nada a ver com a falha.
   */
  it("5xx num plano não impede o apontamento de outro plano", async () => {
    mockedRequest.mockImplementation(async (path) =>
      path.includes("plan-a")
        ? Promise.reject(new ApiError(503, "servidor indisponível", null))
        : { id: "ok" },
    );

    await enqueue(executionCreate("plan-a", "do plano A"));
    await enqueue(executionCreate("plan-b", "do plano B"));

    const result = await flushOutbox();

    expect(result.sent).toBe(1);
    expect(result.outcome).toBe("partial");
    // O do plano B subiu e saiu da fila; o do plano A ficou para depois.
    expect(byLabel("do plano B")).toBeUndefined();
    expect(byLabel("do plano A")?.status).toBe("pending");
  });

  it("4xx recusa só o item e libera os outros recursos", async () => {
    mockedRequest.mockImplementation(async (path) =>
      path.includes("plan-a")
        ? Promise.reject(new ApiError(400, "área inválida", null))
        : { id: "ok" },
    );

    await enqueue(executionCreate("plan-a", "recusado"));
    await enqueue(executionCreate("plan-b", "aceito"));

    const result = await flushOutbox();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(byLabel("aceito")).toBeUndefined();

    const rejected = byLabel("recusado");
    expect(rejected?.status).toBe("failed");
    expect(rejected?.lastError).toBe("área inválida");
  });

  it("bloqueia o resto do recurso quando um item dele é recusado", async () => {
    mockedRequest.mockRejectedValue(
      new ApiError(404, "plano não existe", null),
    );

    await enqueue(executionCreate("plan-a", "primeiro do A"));
    await enqueue(executionCreate("plan-a", "segundo do A"));

    await flushOutbox();

    // O segundo dependia do primeiro: não faz sentido tentar na mesma rodada.
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(byLabel("segundo do A")?.status).toBe("pending");
  });
});

describe("interrupções que valem para a fila inteira", () => {
  it("perda de rede interrompe o lote e preserva tudo", async () => {
    mockedRequest.mockRejectedValue(new OfflineError("sem rede"));

    await enqueue(executionCreate("plan-a"));
    await enqueue(executionCreate("plan-b"));

    const result = await flushOutbox();

    expect(result.outcome).toBe("offline");
    expect(result.sent).toBe(0);
    // Só o primeiro foi tentado: sem rede não há por que insistir no resto.
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(getOutbox()).toHaveLength(2);
    expect(getOutbox().every((entry) => entry.status === "pending")).toBe(true);
  });

  it("sessão inválida interrompe o lote sem recusar o item", async () => {
    mockedRequest.mockRejectedValue(new ApiError(401, "token expirado", null));

    await enqueue(executionCreate("plan-a"));
    await enqueue(executionCreate("plan-b"));

    const result = await flushOutbox();

    expect(result.outcome).toBe("unauthorized");
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    // Continua pendente: o item é válido, o problema é a credencial.
    expect(getOutbox()[0]?.status).toBe("pending");
  });
});

describe("remapeamento do id local", () => {
  /**
   * Um plano criado offline entra na fila com id `local-...`. Quando a API
   * aceita o create e devolve o id real, tudo que ficou na fila apontando para
   * o id provisório precisa ser reescrito — senão a operação seguinte bate num
   * 404 e o registro feito em campo se perde sem aviso.
   */
  it("reescreve caminho, meta e snapshot dos itens dependentes", async () => {
    mockedRequest.mockImplementation(async (path) =>
      path === "/farmers/prod-1/production-plans"
        ? { id: "real-42" }
        : { id: "ok" },
    );

    await enqueue(planCreate("local-1"));
    await enqueue(planUpdate("local-1"));

    await flushOutbox();

    expect(calledPaths()[1]).toBe("/production-plans/real-42");
    expect(getOutbox()).toHaveLength(0);
  });

  it("preserva o id local quando o create é recusado", async () => {
    mockedRequest.mockRejectedValue(
      new ApiError(400, "cultura inválida", null),
    );

    await enqueue(planCreate("local-1"));
    await enqueue(planUpdate("local-1"));

    await flushOutbox();

    expect(byLabel("Editar plano")?.path).toBe("/production-plans/local-1");
  });
});

describe("backoff e teto de tentativas", () => {
  let now = 1_700_000_000_000;

  beforeEach(() => {
    now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("não retenta na mesma rodada um item que acabou de falhar por 5xx", async () => {
    mockedRequest.mockRejectedValue(new ApiError(500, "boom", null));

    await enqueue(executionCreate("plan-a"));

    await flushOutbox();
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    // Segunda tentativa imediata: o item está em espera, ninguém é chamado.
    const second = await flushOutbox();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(second.outcome).toBe("partial");
    expect(second.remaining).toBe(1);
  });

  it("volta a tentar depois da espera", async () => {
    mockedRequest.mockRejectedValue(new ApiError(500, "boom", null));

    await enqueue(executionCreate("plan-a"));
    await flushOutbox();

    now += 31_000; // primeira espera é de 30 s
    await flushOutbox();

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(getOutbox()[0]?.attempts).toBe(2);
  });

  it("passa a exigir reenvio manual após o teto de tentativas", async () => {
    mockedRequest.mockRejectedValue(new ApiError(500, "boom", null));

    await enqueue(executionCreate("plan-a"));

    for (let attempt = 0; attempt < MAX_SERVER_ATTEMPTS; attempt += 1) {
      await flushOutbox();
      now += 60 * 60_000; // além do teto de espera, para liberar a próxima
    }

    const entry = getOutbox()[0];
    expect(entry?.attempts).toBe(MAX_SERVER_ATTEMPTS);
    expect(entry?.status).toBe("failed");
    expect(entry?.lastError).toContain("reenvie manualmente");

    // Item recusado não é mais tentado sozinho.
    const before = mockedRequest.mock.calls.length;
    await flushOutbox();
    expect(mockedRequest).toHaveBeenCalledTimes(before);
  });

  it("reenvio manual zera a espera e o contador", async () => {
    mockedRequest.mockRejectedValue(new ApiError(500, "boom", null));

    await enqueue(executionCreate("plan-a"));
    await flushOutbox();

    const queued = getOutbox()[0];
    expect(queued?.nextAttemptAt).toBeGreaterThan(now);

    await retryEntry(queued!.id);

    const reset = getOutbox()[0];
    expect(reset?.attempts).toBe(0);
    expect(reset?.nextAttemptAt).toBeUndefined();
    expect(reset?.lastError).toBeNull();

    await flushOutbox();
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });
});

describe("conflito (409)", () => {
  /** Resposta do backend: `ConflictApiError`, com a versão do servidor. */
  function conflito(current: unknown) {
    return new ApiError(409, "Alterado por outro usuário.", {
      status: 409,
      message: "Alterado por outro usuário.",
      path: "/production-plans/plan-1",
      timestamp: "2026-09-09T12:00:00",
      current,
    });
  }

  afterEach(() => {
    setConflictReconciler(null);
  });

  it("marca como conflito em vez de recusado, para separar de um dado inválido", async () => {
    mockedRequest.mockRejectedValueOnce(conflito({ id: "plan-1" }));

    await enqueue(planUpdate("plan-1"));
    const result = await flushOutbox();

    expect(result.conflicted).toBe(1);
    expect(result.failed).toBe(0);
    expect(byLabel("Editar plano")?.status).toBe("conflict");
  });

  it("não volta a despachar o item conflitado", async () => {
    mockedRequest.mockRejectedValueOnce(conflito({ id: "plan-1" }));

    await enqueue(planUpdate("plan-1"));
    await flushOutbox();

    mockedRequest.mockClear();
    const segundo = await flushOutbox();

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(segundo.sent).toBe(0);
  });

  it("entrega a versão do servidor ao reconciliador", async () => {
    const servidor = { id: "plan-1", plantedArea: 9, updatedAt: "2026-09-09T10:00:00" };
    const reconciliador = jest.fn().mockResolvedValue(undefined);
    setConflictReconciler(reconciliador);

    mockedRequest.mockRejectedValueOnce(conflito(servidor));

    await enqueue(planUpdate("plan-1"));
    await flushOutbox();

    expect(reconciliador).toHaveBeenCalledTimes(1);
    expect(reconciliador.mock.calls[0][1]).toEqual(servidor);
  });

  it("segue despachando o resto do plano, porque o recurso existe e está mais novo", async () => {
    // Um 4xx comum aborta o restante do recurso; um 409 não deve.
    mockedRequest
      .mockRejectedValueOnce(conflito({ id: "plan-1" }))
      .mockResolvedValueOnce({ id: "exec-1" });

    await enqueue(planUpdate("plan-1"));
    await enqueue(executionCreate("plan-1", "apontamento"));

    const result = await flushOutbox();

    expect(result.conflicted).toBe(1);
    expect(result.sent).toBe(1);
    expect(byLabel("apontamento")).toBeUndefined();
  });

  it("continua tratando os demais 4xx como recusa, abortando o recurso", async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(400, "Dado inválido.", null),
    );

    await enqueue(planUpdate("plan-1"));
    await enqueue(executionCreate("plan-1", "apontamento"));

    const result = await flushOutbox();

    expect(result.failed).toBe(1);
    expect(result.conflicted).toBe(0);
    expect(byLabel("Editar plano")?.status).toBe("failed");
    expect(byLabel("apontamento")?.status).toBe("pending");
  });

  it("não quebra o despacho quando o reconciliador falha", async () => {
    setConflictReconciler(() => Promise.reject(new Error("cache indisponível")));
    mockedRequest.mockRejectedValueOnce(conflito({ id: "plan-1" }));

    await enqueue(planUpdate("plan-1"));

    await expect(flushOutbox()).resolves.toMatchObject({ conflicted: 1 });
    expect(byLabel("Editar plano")?.status).toBe("conflict");
  });

  it("preserva a versão-base gravada no item, que é o que o servidor compara", async () => {
    const entry = await enqueue({
      ...planUpdate("plan-1"),
      baseUpdatedAt: "2026-09-01T08:00:00",
    });

    expect(entry.baseUpdatedAt).toBe("2026-09-01T08:00:00");
  });
});

describe("anexos fotográficos na fila", () => {
  const foto: Attachment = {
    clientId: "11111111-1111-4111-8111-111111111111",
    uri: "file:///doc/attachments/foto.jpg",
    filename: "foto.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 204800,
    capturedAt: "2026-10-07T12:00:00.000Z",
  };

  function anexo(executionId: string, planId = "plan-1"): QueueInput {
    return {
      kind: "attachment.upload",
      method: "POST",
      path: `/production-executions/${executionId}/attachments?clientId=${foto.clientId}`,
      label: "Foto do apontamento",
      upload: foto,
      meta: { planId, executionId },
      invalidates: [`executions:plan:${planId}`],
    };
  }

  it("sobe a imagem pelo upload nativo, fora do caminho JSON", async () => {
    mockedUpload.mockResolvedValue({ id: "att-1" });

    await enqueue(anexo("exec-1"));
    await flushOutbox();

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("apaga o arquivo do aparelho só depois do aceite do servidor", async () => {
    mockedUpload.mockResolvedValue({ id: "att-1" });

    await enqueue(anexo("exec-1"));
    await flushOutbox();

    expect(mockedDiscard).toHaveBeenCalledWith(foto.uri);
    expect(getOutbox()).toHaveLength(0);
  });

  it("preserva o arquivo quando o envio falha, para a retentativa", async () => {
    mockedUpload.mockRejectedValue(new OfflineError("rede caiu"));

    await enqueue(anexo("exec-1"));
    await flushOutbox();

    expect(mockedDiscard).not.toHaveBeenCalled();
    expect(getOutbox()).toHaveLength(1);
  });

  it("preserva o arquivo quando o servidor recusa com 5xx", async () => {
    mockedUpload.mockRejectedValue(new ApiError(500, "falha interna", null));

    await enqueue(anexo("exec-1"));
    await flushOutbox();

    expect(mockedDiscard).not.toHaveBeenCalled();
    expect(byLabel("Foto do apontamento")).toBeDefined();
  });

  it("descartar o item apaga a foto que nunca mais será enviada", async () => {
    const entry = await enqueue(anexo("exec-1"));

    await discardEntry(entry.id);

    expect(mockedDiscard).toHaveBeenCalledWith(foto.uri);
    expect(getOutbox()).toHaveLength(0);
  });

  it("troca o id provisório do apontamento pelo real antes de subir a foto", async () => {
    // O caso de campo: apontamento criado sem sinal, foto anexada nele, e os
    // dois subindo juntos quando a rede volta. Sem o remap, a foto bateria
    // num `local-...` que o servidor não conhece.
    mockedRequest.mockResolvedValue({ id: "exec-real" });
    mockedUpload.mockResolvedValue({ id: "att-1" });

    await enqueue({
      id: "local-exec-1",
      kind: "execution.create",
      method: "POST",
      path: "/production-plans/plan-1/executions",
      body: { actualYield: 10, harvestDate: "2026-10-07" },
      label: "Apontamento offline",
      meta: { planId: "plan-1" },
      invalidates: ["executions:plan:plan-1"],
    });
    await enqueue(anexo("local-exec-1"));

    await flushOutbox();

    const caminho = mockedUpload.mock.calls[0]?.[1];
    expect(caminho).toContain("/production-executions/exec-real/attachments");
    expect(caminho).not.toContain("local-exec-1");
  });

  it("mantém a foto no mesmo recurso do apontamento, para subir depois dele", async () => {
    const execucao = await enqueue(executionCreate("plan-1"));
    const foto1 = await enqueue(anexo("exec-1", "plan-1"));

    expect(streamKeyOf(foto1)).toBe(streamKeyOf(execucao));
  });
});
