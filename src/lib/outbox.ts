import { ApiError, apiRequest, isOfflineError } from "@/lib/api";
import {
  type Attachment,
  discardAttachmentFile,
  uploadAttachment,
} from "@/lib/attachments";
import { notifyInvalidation } from "@/lib/cache";
import { getConnectivity, isProbablyOnline } from "@/lib/net";
import { readJson, StorageKeys, writeJson } from "@/lib/storage";

export type OutboxKind =
  | "plan.create"
  | "plan.update"
  | "plan.delete"
  | "execution.create"
  | "execution.update"
  | "execution.delete"
  | "attachment.upload";

/**
 * `failed` é operação inválida, a corrigir ou descartar; `conflict` era válida
 * e só perdeu a corrida. Só `pending` volta a ser despachado sozinho.
 */
export type OutboxStatus = "pending" | "failed" | "conflict";

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
   * Como a entidade aparece na tela enquanto não sincroniza. Vive à parte
   * porque `body` precisa ter exatamente o formato que a API espera.
   */
  snapshot?: unknown;
  createdAt: number;
  /**
   * Versão que o usuário tinha em mãos ao editar, e é o que o servidor compara.
   * O instante da edição não serviria: feito offline, ele chega sempre mais
   * recente que o do servidor e venceria toda disputa.
   */
  baseUpdatedAt?: string | null;
  /**
   * Fora de `body` porque não é JSON: o despacho lê do disco e sobe em
   * multipart. Até o aceite, `upload.uri` é a única cópia da comprovação.
   */
  upload?: Attachment;
  attempts: number;
  lastError: string | null;
  status: OutboxStatus;
  /** Quando vale tentar de novo. Ausente em itens antigos; `?? 0` os libera. */
  nextAttemptAt?: number;
  meta: {
    farmerId?: string;
    planId?: string;
    executionId?: string;
  };
  /** Chaves de cache a invalidar quando a operação for aceita pela API. */
  invalidates: string[];
};

/**
 * Como gravar a versão que o servidor devolveu no 409. Interpretar o corpo é
 * do domínio, que já importa a fila — então ele se registra aqui no boot.
 */
export type ConflictReconciler = (
  entry: OutboxEntry,
  serverVersion: unknown,
) => Promise<void>;

let reconcileConflict: ConflictReconciler | null = null;

export function setConflictReconciler(fn: ConflictReconciler | null): void {
  reconcileConflict = fn;
}

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

export function getConflictCount(): number {
  return entries.filter((entry) => entry.status === "conflict").length;
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
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    upload: input.upload,
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
  // Descartar é decidir não enviar: o arquivo não tem mais por que ficar.
  const entry = entries.find((item) => item.id === id);
  if (entry?.upload) discardAttachmentFile(entry.upload.uri);

  entries = entries.filter((item) => item.id !== id);
  await persist();
}

/** Quem aperta "tentar de novo" quer agora, não daqui a 30 min. */
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
  entries.forEach((entry) => {
    if (entry.upload) discardAttachmentFile(entry.upload.uri);
  });
  entries = [];
  await persist();
}

/** Operações pendentes que afetam um plano (usado no overlay otimista). */
export function pendingForPlan(planId: string): OutboxEntry[] {
  return entries.filter((entry) => entry.meta.planId === planId);
}

export function pendingForFarmer(farmerId: string): OutboxEntry[] {
  return entries.filter((entry) => entry.meta.farmerId === farmerId);
}

// ----- Sincronização -----

export type FlushOutcome =
  "idle" | "offline" | "unauthorized" | "synced" | "partial";

export type FlushResult = {
  outcome: FlushOutcome;
  sent: number;
  failed: number;
  /** Itens recusados por alteração concorrente (409). */
  conflicted: number;
  remaining: number;
};

/** Sem esse teto, um item que o servidor nunca aceita fica em rodízio infinito. */
export const MAX_SERVER_ATTEMPTS = 5;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Espera exponencial entre tentativas, com teto de 30 min. */
export function backoffFor(attempts: number): number {
  const delay = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, BACKOFF_MAX_MS);
}

/**
 * Recurso a que o item pertence. A ordem só importa dentro de um recurso: um
 * 5xx no plano A não pode segurar o apontamento do plano B.
 *
 * `plan.create` não tem `meta.planId` — ali o id do plano é o do próprio item.
 */
export function streamKeyOf(entry: OutboxEntry): string {
  return `plan:${entry.meta.planId ?? entry.id}`;
}

/**
 * Promessa compartilhada: um booleano não serviria, por ser atribuído só
 * depois do `await` — duas chamadas simultâneas passariam e despachariam a
 * fila em dobro. Assim a segunda ainda recebe o resultado real da primeira.
 */
let emAndamento: Promise<FlushResult> | null = null;

/**
 * Envia por recurso: em ordem dentro de um, independentes entre si. Só perda
 * de rede e sessão inválida param o lote inteiro — o resto trava um recurso só.
 */
export function flushOutbox(): Promise<FlushResult> {
  emAndamento ??= despachar().finally(() => {
    emAndamento = null;
  });
  return emAndamento;
}

async function despachar(): Promise<FlushResult> {
  await loadOutbox();

  const pending = entries.filter((entry) => entry.status === "pending");
  if (pending.length === 0) {
    return {
      outcome: "synced",
      sent: 0,
      failed: 0,
      conflicted: 0,
      remaining: 0,
    };
  }

  if (!isProbablyOnline(getConnectivity())) {
    return {
      outcome: "offline",
      sent: 0,
      failed: 0,
      conflicted: 0,
      remaining: pending.length,
    };
  }

  /*
   * Agrupa ANTES de olhar o backoff. Filtrando primeiro, um item em espera
   * saía da rodada e os seguintes do mesmo plano subiam sem ele — o `update`
   * partia para `/production-plans/local-…`, levava 400 e a edição se perdia.
   * Agora cada recurso despacha só o trecho inicial que está pronto.
   */
  const now = Date.now();
  const grupos = new Map<string, OutboxEntry[]>();
  for (const entry of pending) {
    const key = streamKeyOf(entry);
    const grupo = grupos.get(key);
    if (grupo) grupo.push(entry);
    else grupos.set(key, [entry]);
  }

  const streams = new Map<string, string[]>();
  for (const [key, grupo] of grupos) {
    const prontos: string[] = [];
    for (const entry of grupo) {
      if ((entry.nextAttemptAt ?? 0) > now) break;
      prontos.push(entry.id);
    }
    if (prontos.length > 0) streams.set(key, prontos);
  }

  if (streams.size === 0) {
    return {
      outcome: "partial",
      sent: 0,
      failed: 0,
      conflicted: 0,
      remaining: pending.length,
    };
  }

  const invalidated = new Set<string>();
  let sent = 0;
  let failed = 0;
  let conflicted = 0;
  let blockedStreams = 0;
  let outcome: FlushOutcome = "synced";

  streamLoop: for (const ids of streams.values()) {
    for (const id of ids) {
      // Relê do estado: um remap nesta mesma rodada pode ter mudado o `path`.
      const entry = entries.find((item) => item.id === id);
      if (!entry || entry.status !== "pending") continue;

      try {
        const result = entry.upload
          ? await uploadAttachment(entry.upload, entry.path)
          : await apiRequest<unknown>(entry.path, {
              method: entry.method,
              body: entry.body,
              force: true,
            });

        entries = entries.filter((item) => item.id !== entry.id);
        entry.invalidates.forEach((key) => invalidated.add(key));
        sent += 1;

        // Só depois do aceite: antes disso, é a única cópia de um item que
        // ainda pode precisar ser reenviado.
        if (entry.upload) discardAttachmentFile(entry.upload.uri);

        // Quem ficou na fila apontando para o id local passa a apontar para
        // o real; senão o próximo item bate num 404 e o registro se perde.
        if (entry.kind === "plan.create" || entry.kind === "execution.create") {
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

          if (error.status === 409) {
            // Perdeu a corrida, mas era válido: a versão do servidor vem no
            // corpo e substitui a local, e o item fica marcado para o usuário.
            await applyServerVersion(entry, error.payload, invalidated);
            await markError(entry.id, error.message, "conflict");
            conflicted += 1;
            // Diferente de um 4xx: o recurso existe, então o resto do plano
            // segue aplicável.
            continue;
          }

          if (error.status >= 500) {
            // O item continua válido: espera e tenta depois.
            await markServerFailure(entry.id, error.message);
            blockedStreams += 1;
            continue streamLoop;
          }

          // Item inválido: pula o resto do recurso, que dependia dele.
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

  if (invalidated.size > 0) notifyInvalidation([...invalidated]);

  const remaining = getPendingCount();
  if (
    outcome === "synced" &&
    (remaining > 0 || failed > 0 || conflicted > 0 || blockedStreams > 0)
  ) {
    outcome = "partial";
  }

  return { outcome, sent, failed, conflicted, remaining };
}

/**
 * Entrega ao reconciliador a versão que veio no 409 (`ConflictApiError.current`).
 * Falha ao gravar não derruba o despacho: o item já está marcado, e as chaves
 * são invalidadas de qualquer forma.
 */
async function applyServerVersion(
  entry: OutboxEntry,
  payload: unknown,
  invalidated: Set<string>,
): Promise<void> {
  entry.invalidates.forEach((key) => invalidated.add(key));

  const current =
    payload && typeof payload === "object"
      ? (payload as { current?: unknown }).current
      : undefined;

  if (current === undefined || current === null || !reconcileConflict) return;

  try {
    await reconcileConflict(entry, current);
  } catch {
    // Sem versão local atualizada, resta a invalidação acima.
  }
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

/** Troca o id provisório pelo real no caminho, `meta`, chaves e snapshot. */
function remapLocalId(
  localId: string,
  realId: string,
  invalidated: Set<string>,
): void {
  entries = entries.map((entry) => {
    const inPath = entry.path.includes(localId);
    const inMeta =
      entry.meta.planId === localId || entry.meta.executionId === localId;
    const inKeys = entry.invalidates.some((key) => key.includes(localId));

    if (!inPath && !inMeta && !inKeys) return entry;

    // A tela ainda escuta a chave antiga: avisa as duas.
    entry.invalidates.forEach((key) => {
      if (key.includes(localId)) invalidated.add(key);
    });

    return {
      ...entry,
      path: inPath ? entry.path.split(localId).join(realId) : entry.path,
      meta: inMeta
        ? {
            ...entry.meta,
            planId: entry.meta.planId === localId ? realId : entry.meta.planId,
            executionId:
              entry.meta.executionId === localId
                ? realId
                : entry.meta.executionId,
          }
        : entry.meta,
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
