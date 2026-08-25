import { ApiError, apiRequest, isOfflineError } from "@/lib/api";
import { notifyInvalidation } from "@/lib/cache";
import { getConnectivity, isProbablyOnline } from "@/lib/net";
import { readJson, StorageKeys, writeJson } from "@/lib/storage";

export type OutboxKind =
  | "plan.create"
  | "plan.update"
  | "plan.delete"
  | "execution.create"
  | "execution.update"
  | "execution.delete";

export type OutboxStatus = "pending" | "failed";

export type OutboxEntry = {
  /** Id local (`local-...`), também usado como id provisório da entidade. */
  id: string;
  kind: OutboxKind;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  /** Texto curto exibido na tela de sincronização. */
  label: string;
  /**
   * A entidade como ela deve aparecer localmente enquanto não sincroniza.
   * O `body` precisa ter exatamente o shape que a API espera, então o que a
   * tela mostra (nome da cultura, rótulo da safra) vive aqui à parte.
   */
  snapshot?: unknown;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  status: OutboxStatus;
  /**
   * Momento a partir do qual vale tentar de novo (backoff após falha de
   * servidor). Ausente em itens gravados antes deste campo existir — o `?? 0`
   * na leitura trata esse caso como "pode tentar agora".
   */
  nextAttemptAt?: number;
  meta: {
    producerId?: string;
    planId?: string;
    executionId?: string;
  };
  /** Chaves de cache a invalidar quando a operação for aceita pela API. */
  invalidates: string[];
};

let localIdCounter = 0;

export function createLocalId(): string {
  localIdCounter += 1;
  return `local-${Date.now().toString(36)}-${localIdCounter}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

// ----- Estado em memória + persistência -----

let entries: OutboxEntry[] = [];
let loaded = false;
const listeners = new Set<(entries: OutboxEntry[]) => void>();

function emit(): void {
  const snapshot = [...entries];
  listeners.forEach((listener) => listener(snapshot));
}

async function persist(): Promise<void> {
  await writeJson(StorageKeys.outbox, entries);
  emit();
}

export async function loadOutbox(): Promise<OutboxEntry[]> {
  if (loaded) return [...entries];
  entries = (await readJson<OutboxEntry[]>(StorageKeys.outbox)) ?? [];
  loaded = true;
  emit();
  return [...entries];
}

export function getOutbox(): OutboxEntry[] {
  return [...entries];
}

export function getPendingCount(): number {
  return entries.filter((entry) => entry.status === "pending").length;
}

export function getFailedCount(): number {
  return entries.filter((entry) => entry.status === "failed").length;
}

export function subscribeOutbox(
  listener: (entries: OutboxEntry[]) => void,
): () => void {
  listeners.add(listener);
  listener([...entries]);
  return () => {
    listeners.delete(listener);
  };
}

export async function enqueue(
  input: Omit<
    OutboxEntry,
    "id" | "createdAt" | "attempts" | "lastError" | "status"
  > & { id?: string },
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: input.id ?? createLocalId(),
    kind: input.kind,
    method: input.method,
    path: input.path,
    body: input.body,
    label: input.label,
    snapshot: input.snapshot,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    status: "pending",
    meta: input.meta,
    invalidates: input.invalidates,
  };

  entries = [...entries, entry];
  await persist();
  return entry;
}

export async function discardEntry(id: string): Promise<void> {
  entries = entries.filter((entry) => entry.id !== id);
  await persist();
}

/**
 * Reenvio pedido pelo usuário: sai do backoff e zera o contador de tentativas.
 * Quem aperta "tentar de novo" quer uma tentativa agora, não daqui a 30 min.
 */
export async function retryEntry(id: string): Promise<void> {
  entries = entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          status: "pending" as const,
          lastError: null,
          attempts: 0,
          nextAttemptAt: undefined,
        }
      : entry,
  );
  await persist();
}

export async function clearOutbox(): Promise<void> {
  entries = [];
  await persist();
}

/** Operações pendentes que afetam um plano (usado no overlay otimista). */
export function pendingForPlan(planId: string): OutboxEntry[] {
  return entries.filter((entry) => entry.meta.planId === planId);
}

export function pendingForProducer(producerId: string): OutboxEntry[] {
  return entries.filter((entry) => entry.meta.producerId === producerId);
}

// ----- Sincronização -----

export type FlushOutcome =
  "idle" | "offline" | "unauthorized" | "synced" | "partial";

export type FlushResult = {
  outcome: FlushOutcome;
  sent: number;
  failed: number;
  remaining: number;
};

/**
 * Falhas de servidor (5xx ou erro desconhecido) que um item aceita antes de
 * parar de tentar sozinho e passar a exigir reenvio manual. Sem esse teto, um
 * item que o servidor nunca aceita fica em rodízio infinito.
 */
export const MAX_SERVER_ATTEMPTS = 5;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Espera exponencial entre tentativas, com teto de 30 min. */
export function backoffFor(attempts: number): number {
  const delay = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, BACKOFF_MAX_MS);
}

/**
 * Recurso a que o item pertence.
 *
 * A ordem só importa entre operações do MESMO recurso: um `update` depende do
 * `create` anterior e um apontamento depende do plano que o hospeda. Entre
 * recursos diferentes não existe dependência — então um 5xx no plano A não
 * pode impedir o apontamento do plano B de subir, que era exatamente o que
 * acontecia enquanto a fila era um único lote serial.
 *
 * `plan.create` ainda não tem `meta.planId`: ali o id do plano é o próprio id
 * do item (o `local-...` que a tela usa como id provisório).
 */
export function streamKeyOf(entry: OutboxEntry): string {
  return `plan:${entry.meta.planId ?? entry.id}`;
}

let flushing = false;

/**
 * Envia a fila agrupada por recurso: dentro de um recurso, em ordem de
 * criação; entre recursos, de forma independente.
 *
 * Só duas condições interrompem o lote inteiro, porque valem para qualquer
 * item: perda de rede e sessão inválida. Um problema específico de um recurso
 * bloqueia apenas aquele recurso.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing) {
    return {
      outcome: "idle",
      sent: 0,
      failed: 0,
      remaining: getPendingCount(),
    };
  }

  await loadOutbox();

  const pending = entries.filter((entry) => entry.status === "pending");
  if (pending.length === 0) {
    return { outcome: "synced", sent: 0, failed: 0, remaining: 0 };
  }

  if (!isProbablyOnline(getConnectivity())) {
    return {
      outcome: "offline",
      sent: 0,
      failed: 0,
      remaining: pending.length,
    };
  }

  // Itens ainda em backoff ficam de fora desta rodada.
  const now = Date.now();
  const ready = pending.filter((entry) => (entry.nextAttemptAt ?? 0) <= now);
  if (ready.length === 0) {
    return {
      outcome: "partial",
      sent: 0,
      failed: 0,
      remaining: pending.length,
    };
  }

  // Agrupa por recurso preservando a ordem de criação dentro de cada grupo.
  const streams = new Map<string, string[]>();
  for (const entry of ready) {
    const key = streamKeyOf(entry);
    const ids = streams.get(key);
    if (ids) ids.push(entry.id);
    else streams.set(key, [entry.id]);
  }

  flushing = true;
  const invalidated = new Set<string>();
  let sent = 0;
  let failed = 0;
  let blockedStreams = 0;
  let outcome: FlushOutcome = "synced";

  try {
    streamLoop: for (const ids of streams.values()) {
      for (const id of ids) {
        // Relê do estado em vez de usar o objeto do agrupamento: um remap de
        // id local feito nesta mesma rodada pode ter reescrito o `path`.
        const entry = entries.find((item) => item.id === id);
        if (!entry || entry.status !== "pending") continue;

        try {
          const result = await apiRequest<unknown>(entry.path, {
            method: entry.method,
            body: entry.body,
            force: true,
          });

          entries = entries.filter((item) => item.id !== entry.id);
          entry.invalidates.forEach((key) => invalidated.add(key));
          sent += 1;

          // O create devolveu o id real. Quem ficou na fila apontando para o
          // id local precisa passar a apontar para ele — senão o próximo item
          // do mesmo plano bate num 404 e o registro se perde.
          if (entry.kind === "plan.create") {
            const realId = idFromPayload(result);
            if (realId !== null) remapLocalId(entry.id, realId, invalidated);
          }

          await persist();
        } catch (error) {
          if (isOfflineError(error)) {
            // Sem rede não há o que tentar em nenhum outro recurso.
            outcome = "offline";
            break streamLoop;
          }

          if (error instanceof ApiError) {
            if (error.status === 401 || error.status === 403) {
              // Sessão inválida vale para a fila inteira.
              outcome = "unauthorized";
              await markError(entry.id, error.message, "pending");
              break streamLoop;
            }

            if (error.status >= 500) {
              // Problema do servidor: o item continua válido. Espera e tenta
              // depois — e só este recurso fica bloqueado.
              await markServerFailure(entry.id, error.message);
              blockedStreams += 1;
              continue streamLoop;
            }

            // 4xx: o item é inválido (plano apagado, dado recusado). Marca e
            // pula o resto deste recurso, cujos itens dependiam dele.
            await markError(entry.id, error.message, "failed");
            failed += 1;
            continue streamLoop;
          }

          await markServerFailure(entry.id, String(error));
          blockedStreams += 1;
          continue streamLoop;
        }
      }
    }
  } finally {
    flushing = false;
  }

  if (invalidated.size > 0) notifyInvalidation([...invalidated]);

  const remaining = getPendingCount();
  if (
    outcome === "synced" &&
    (remaining > 0 || failed > 0 || blockedStreams > 0)
  ) {
    outcome = "partial";
  }

  return { outcome, sent, failed, remaining };
}

async function markError(
  id: string,
  message: string,
  status: OutboxStatus,
): Promise<void> {
  entries = entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          attempts: entry.attempts + 1,
          lastError: message,
          status,
        }
      : entry,
  );
  await persist();
}

/**
 * Falha que não é culpa do item (5xx, erro inesperado): agenda nova tentativa
 * com espera crescente e, esgotado o teto, entrega para o usuário decidir.
 */
async function markServerFailure(id: string, message: string): Promise<void> {
  entries = entries.map((entry) => {
    if (entry.id !== id) return entry;

    const attempts = entry.attempts + 1;
    const exhausted = attempts >= MAX_SERVER_ATTEMPTS;

    return {
      ...entry,
      attempts,
      lastError: exhausted
        ? `${message} (${attempts} tentativas sem sucesso — reenvie manualmente)`
        : message,
      status: exhausted ? ("failed" as const) : ("pending" as const),
      nextAttemptAt: exhausted ? undefined : Date.now() + backoffFor(attempts),
    };
  });
  await persist();
}

function idFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Troca o id provisório pelo id real em tudo que ficou na fila: caminho da
 * requisição, `meta`, chaves de invalidação e o snapshot exibido na tela.
 */
function remapLocalId(
  localId: string,
  realId: string,
  invalidated: Set<string>,
): void {
  entries = entries.map((entry) => {
    const inPath = entry.path.includes(localId);
    const inMeta = entry.meta.planId === localId;
    const inKeys = entry.invalidates.some((key) => key.includes(localId));

    if (!inPath && !inMeta && !inKeys) return entry;

    // A tela ainda escuta a chave antiga: avisa as duas.
    entry.invalidates.forEach((key) => {
      if (key.includes(localId)) invalidated.add(key);
    });

    return {
      ...entry,
      path: inPath ? entry.path.split(localId).join(realId) : entry.path,
      meta: inMeta ? { ...entry.meta, planId: realId } : entry.meta,
      invalidates: entry.invalidates.map((key) =>
        key.split(localId).join(realId),
      ),
      snapshot: remapSnapshotId(entry.snapshot, localId, realId),
    };
  });
}

/** Campos de snapshot que carregam id de plano (`ProductionPlan`/`Execution`). */
const SNAPSHOT_ID_FIELDS = ["id", "productionPlanId"] as const;

function remapSnapshotId(
  snapshot: unknown,
  localId: string,
  realId: string,
): unknown {
  if (!snapshot || typeof snapshot !== "object") return snapshot;

  const record = snapshot as Record<string, unknown>;
  const next = { ...record };
  let changed = false;

  for (const field of SNAPSHOT_ID_FIELDS) {
    if (next[field] === localId) {
      next[field] = realId;
      changed = true;
    }
  }

  return changed ? next : snapshot;
}
