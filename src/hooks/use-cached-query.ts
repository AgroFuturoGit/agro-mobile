import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, isOfflineError } from "@/lib/api";
import { readCache, subscribeInvalidation, writeCache } from "@/lib/cache";
import {
  getConnectivity,
  isProbablyOnline,
  subscribeConnectivity,
} from "@/lib/net";

export type CachedQuery<T> = {
  data: T | null;
  /** Primeira carga, ainda sem nada para mostrar. */
  loading: boolean;
  /** Revalidando com dado já na tela. */
  refreshing: boolean;
  /** Erro vindo da API (validação, permissão). Offline não entra aqui. */
  error: string | null;
  /** O que está na tela veio do cache e a revalidação não passou. */
  stale: boolean;
  cachedAt: number | null;
  refetch: () => Promise<void>;
};

type QueryState<T> = {
  /**
   * Chave a que este estado pertence. Guardar junto evita exibir por um
   * instante o dado da chave anterior quando a tela troca de recurso.
   */
  key: string | null;
  data: T | null;
  cachedAt: number | null;
  refreshing: boolean;
  error: string | null;
  stale: boolean;
  settled: boolean;
};

const EMPTY_STATE: QueryState<never> = {
  key: null,
  data: null,
  cachedAt: null,
  refreshing: false,
  error: null,
  stale: false,
  settled: false,
};

/**
 * Leitura cache-first: mostra o que já está no aparelho e revalida em
 * seguida. Sem rede, o cache é a resposta — não um erro.
 *
 * Passe `key = null` para desabilitar (ex.: enquanto o id do agricultor ainda
 * não foi resolvido).
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): CachedQuery<T> {
  const [state, setState] = useState<QueryState<T>>(EMPTY_STATE);

  // O fetcher costuma ser recriado a cada render; guardá-lo num ref evita
  // que a identidade da função vire dependência do efeito e provoque um
  // ciclo de refetch infinito.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (key === null) return;

    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;

    const isCurrent = () =>
      mounted.current && requestId.current === currentRequest;

    const patch = (next: Partial<QueryState<T>>) => {
      setState((previous) => ({ ...previous, key, ...next }));
    };

    const cached = await readCache<T>(key);
    if (!isCurrent()) return;

    if (cached) {
      patch({
        data: cached.data,
        cachedAt: cached.cachedAt,
        settled: true,
      });
    }

    if (!isProbablyOnline(getConnectivity())) {
      patch({
        stale: cached !== null,
        refreshing: false,
        settled: true,
      });
      return;
    }

    patch({ refreshing: true });

    try {
      const fresh = await fetcherRef.current();
      if (!isCurrent()) return;

      const entry = await writeCache(key, fresh);
      if (!isCurrent()) return;

      patch({
        data: fresh,
        cachedAt: entry.cachedAt,
        stale: false,
        error: null,
        refreshing: false,
        settled: true,
      });
    } catch (caught) {
      if (!isCurrent()) return;

      if (isOfflineError(caught)) {
        // Servidor inalcançável: o cache continua sendo a melhor resposta.
        patch({ stale: true, refreshing: false, settled: true });
      } else if (caught instanceof ApiError) {
        patch({ error: caught.message, refreshing: false, settled: true });
      } else {
        patch({
          error: "Falha inesperada ao carregar os dados.",
          refreshing: false,
          settled: true,
        });
      }
    }
  }, [key]);

  useEffect(() => {
    void run();
  }, [run]);

  // Uma mutação (direta ou vinda do outbox) invalidou este recurso.
  useEffect(() => {
    if (key === null) return;
    return subscribeInvalidation((keys) => {
      if (keys.includes(key)) void run();
    });
  }, [key, run]);

  // Voltou o sinal com dado velho na tela: revalida sozinho.
  const isStale = state.key === key && state.stale;
  useEffect(() => {
    if (key === null || !isStale) return;
    return subscribeConnectivity((connectivity) => {
      if (isProbablyOnline(connectivity)) void run();
    });
  }, [key, isStale, run]);

  const matches = state.key === key;

  return {
    data: matches ? state.data : null,
    loading: key !== null && (!matches || !state.settled),
    refreshing: matches && state.refreshing,
    error: matches ? state.error : null,
    stale: matches && state.stale,
    cachedAt: matches ? state.cachedAt : null,
    refetch: run,
  };
}
