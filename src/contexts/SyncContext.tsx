import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/contexts/AuthContext";
import { reconcileProductionConflict } from "@/domain/production";
import {
  type Connectivity,
  getConnectivity,
  isProbablyOnline,
  refreshConnectivity,
  subscribeConnectivity,
} from "@/lib/net";
import {
  discardEntry,
  flushOutbox,
  type FlushResult,
  loadOutbox,
  type OutboxEntry,
  retryEntry,
  setConflictReconciler,
  subscribeOutbox,
} from "@/lib/outbox";

type SyncContextValue = {
  online: boolean;
  connectionType: string;
  entries: OutboxEntry[];
  pendingCount: number;
  failedCount: number;
  /** Itens recusados porque outra pessoa alterou o mesmo registro. */
  conflictCount: number;
  syncing: boolean;
  lastSyncAt: number | null;
  lastResult: FlushResult | null;
  sync: () => Promise<FlushResult>;
  discard: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { status, sessionExpired } = useAuth();

  const [connectivity, setConnectivity] =
    useState<Connectivity>(getConnectivity());
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<FlushResult | null>(null);

  // Quem sabe interpretar a versão devolvida num 409 é o domínio; a fila só
  // detecta o conflito. Registrar aqui evita inverter a dependência.
  useEffect(() => {
    setConflictReconciler(reconcileProductionConflict);
    return () => setConflictReconciler(null);
  }, []);

  useEffect(() => {
    void loadOutbox();
    const unsubscribeOutbox = subscribeOutbox(setEntries);
    const unsubscribeNet = subscribeConnectivity(setConnectivity);
    void refreshConnectivity();

    return () => {
      unsubscribeOutbox();
      unsubscribeNet();
    };
  }, []);

  const online = isProbablyOnline(connectivity);
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const failedCount = entries.filter((e) => e.status === "failed").length;
  const conflictCount = entries.filter((e) => e.status === "conflict").length;

  const sync = useCallback(async (): Promise<FlushResult> => {
    setSyncing(true);
    try {
      const result = await flushOutbox();
      setLastResult(result);
      if (result.sent > 0) setLastSyncAt(Date.now());
      return result;
    } finally {
      setSyncing(false);
    }
  }, []);

  /*
   * Sincroniza sozinho em três momentos, e só neles: quando a conexão volta,
   * quando um item novo entra na fila, e quando a espera de um item vence.
   *
   * A versão anterior dependia de `syncing` e `lastSyncAt` e girava em falso.
   * `lastSyncAt` só é preenchido quando algum item sobe, então uma rodada que
   * falhava deixava a condição `!lastSyncAt` verdadeira; ao terminar, `syncing`
   * voltava a `false`, o efeito disparava de novo, e assim indefinidamente. O
   * QA mediu cerca de 1.570 requisições em 50 segundos.
   *
   * Comparar a contagem de pendentes com a anterior é o que substitui aquela
   * condição sem reabrir o laço: uma rodada que falha não altera a contagem, e
   * portanto não se redispara sozinha.
   */
  const wasOnline = useRef(online);
  const pendentesAntes = useRef(pendingCount);

  useEffect(() => {
    const podeSincronizar = status === "signed-in" && !sessionExpired;
    const voltouOnline = online && !wasOnline.current;
    const entrouItemNovo = pendingCount > pendentesAntes.current;

    wasOnline.current = online;
    pendentesAntes.current = pendingCount;

    if (!podeSincronizar || !online || pendingCount === 0) return;
    if (voltouOnline || entrouItemNovo) void sync();
  }, [online, status, sessionExpired, pendingCount, sync]);

  /*
   * O despertador do backoff.
   *
   * Sem ele, um item que levou 5xx ficaria esperando por um evento de rede ou
   * pelo toque em "Sincronizar agora" — antes, era o próprio laço que acabava
   * tentando de novo, por acidente. O relógio é armado para o item que vence
   * primeiro, e uma só vez.
   */
  useEffect(() => {
    if (status !== "signed-in" || sessionExpired || !online) return;

    const esperas = entries
      .filter((e) => e.status === "pending" && (e.nextAttemptAt ?? 0) > Date.now())
      .map((e) => e.nextAttemptAt as number);

    if (esperas.length === 0) return;

    const atraso = Math.max(0, Math.min(...esperas) - Date.now()) + 250;
    const relogio = setTimeout(() => void sync(), atraso);
    return () => clearTimeout(relogio);
  }, [entries, online, status, sessionExpired, sync]);

  const discard = useCallback(async (id: string) => {
    await discardEntry(id);
  }, []);

  const retry = useCallback(
    async (id: string) => {
      await retryEntry(id);
      if (online) await sync();
    },
    [online, sync],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      online,
      connectionType: connectivity.type,
      entries,
      pendingCount,
      failedCount,
      conflictCount,
      syncing,
      lastSyncAt,
      lastResult,
      sync,
      discard,
      retry,
    }),
    [
      online,
      connectivity.type,
      entries,
      pendingCount,
      failedCount,
      conflictCount,
      syncing,
      lastSyncAt,
      lastResult,
      sync,
      discard,
      retry,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync precisa estar dentro de <SyncProvider>.");
  }
  return context;
}
