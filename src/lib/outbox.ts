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

export async function retryEntry(id: string): Promise<void> {
  entries = entries.map((entry) =>
    entry.id === id
      ? { ...entry, status: "pending" as const, lastError: null }
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
  | "idle"
  | "offline"
  | "unauthorized"
  | "synced"
  | "partial";

export type FlushResult = {
  outcome: FlushOutcome;
  sent: number;
  failed: number;
  remaining: number;
};

let flushing = false;

/**
 * Envia a fila em ordem de criação, parando no primeiro erro que não seja
 * culpa do próprio item.
 *
 * A ordem importa: um `update` só faz sentido depois do `create` do mesmo
 * recurso. Por isso a fila é serial e uma queda de rede interrompe o lote em
 * vez de pular para o próximo item.
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

  flushing = true;
  const invalidated = new Set<string>();
  let sent = 0;
  let failed = 0;
  let outcome: FlushOutcome = "synced";

  try {
    for (const entry of pending) {
      try {
        await apiRequest(entry.path, {
          method: entry.method,
          body: entry.body,
          force: true,
        });
        entries = entries.filter((item) => item.id !== entry.id);
        entry.invalidates.forEach((key) => invalidated.add(key));
        sent += 1;
        await persist();
      } catch (error) {
        if (isOfflineError(error)) {
          // A rede caiu no meio do lote: o resto continua pendente.
          outcome = "offline";
          break;
        }

        if (error instanceof ApiError) {
          if (error.status === 401 || error.status === 403) {
            // Sessão inválida — reenviar agora só geraria mais 401.
            outcome = "unauthorized";
            await markError(entry.id, error.message, "pending");
            break;
          }

          if (error.status >= 500) {
            // Problema do servidor: item continua válido, tenta depois.
            outcome = "partial";
            await markError(entry.id, error.message, "pending");
            break;
          }

          // 4xx: o item é inválido (plano apagado, dado rejeitado). Marcar
          // como falho e seguir — senão a fila inteira trava por causa dele.
          await markError(entry.id, error.message, "failed");
          failed += 1;
          continue;
        }

        outcome = "partial";
        await markError(entry.id, String(error), "pending");
        break;
      }
    }
  } finally {
    flushing = false;
  }

  if (invalidated.size > 0) notifyInvalidation([...invalidated]);

  const remaining = getPendingCount();
  if (outcome === "synced" && (remaining > 0 || failed > 0)) {
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
