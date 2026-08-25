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
  subscribeOutbox,
} from "@/lib/outbox";

type SyncContextValue = {
  online: boolean;
  connectionType: string;
  entries: OutboxEntry[];
  pendingCount: number;
  failedCount: number;
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

  // Sincroniza sozinho quando a conexão volta. O ref evita disparar de novo a
  // cada re-render enquanto o mesmo estado de rede persiste.
  const wasOnline = useRef(online);
  useEffect(() => {
    const canSync = status === "signed-in" && !sessionExpired;
    const cameBackOnline = online && !wasOnline.current;
    wasOnline.current = online;

    if (
      canSync &&
      online &&
      !syncing &&
      pendingCount > 0 &&
      (cameBackOnline || !lastSyncAt)
    ) {
      void sync();
    }
  }, [online, status, sessionExpired, syncing, pendingCount, lastSyncAt, sync]);

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
