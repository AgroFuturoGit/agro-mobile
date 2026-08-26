import { ApiError, apiRequest, OfflineError } from "@/lib/api";
import {
  clearOutbox,
  enqueue,
  flushOutbox,
  getOutbox,
  MAX_SERVER_ATTEMPTS,
  type OutboxEntry,
  retryEntry,
  streamKeyOf,
} from "@/lib/outbox";

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, apiRequest: jest.fn() };
});

// A fila decide se envia agora consultando a conectividade. Nos testes ela é
// fixada em "online" — quem controla o resultado é o mock do `apiRequest`.
jest.mock("@/lib/net", () => ({
  getConnectivity: () => ({
    isConnected: true,
    isInternetReachable: true,
    type: "wifi",
  }),
  isProbablyOnline: () => true,
}));

const mockedRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

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

function planCreate(localId: string, producerId = "prod-1"): QueueInput {
  return {
    id: localId,
    kind: "plan.create",
    method: "POST",
    path: `/producers/${producerId}/production-plans`,
    body: { cropId: "c1", harvestId: "h1", plantedArea: 2, expectedYield: 100 },
    label: "Novo plano",
    snapshot: { id: localId, plantedArea: 2 },
    meta: { producerId },
    invalidates: [`plans:producer:${producerId}`],
  };
}

function planUpdate(planId: string, producerId = "prod-1"): QueueInput {
  return {
    kind: "plan.update",
    method: "PUT",
    path: `/production-plans/${planId}`,
    body: { plantedArea: 3, expectedYield: 120 },
    label: "Editar plano",
    snapshot: { id: planId, plantedArea: 3 },
    meta: { producerId, planId },
    invalidates: [`plans:producer:${producerId}`, `plan:${planId}`],
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
  mockedRequest.mockReset();
  await clearOutbox();
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
      "/producers/prod-1/production-plans",
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
      path === "/producers/prod-1/production-plans"
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
