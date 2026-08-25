import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

export type Connectivity = {
  /** Há interface de rede ativa. */
  isConnected: boolean;
  /**
   * A internet foi de fato alcançada. `null` enquanto o NetInfo ainda não
   * concluiu a sondagem — nesse caso tratamos como "provavelmente online"
   * para não bloquear a primeira requisição.
   */
  isInternetReachable: boolean | null;
  type: string;
};

const INITIAL: Connectivity = {
  isConnected: true,
  isInternetReachable: null,
  type: "unknown",
};

let current: Connectivity = INITIAL;
const listeners = new Set<(state: Connectivity) => void>();

function toConnectivity(state: NetInfoState): Connectivity {
  return {
    isConnected: state.isConnected ?? false,
    isInternetReachable: state.isInternetReachable,
    type: state.type,
  };
}

NetInfo.addEventListener((state) => {
  current = toConnectivity(state);
  listeners.forEach((listener) => listener(current));
});

export function getConnectivity(): Connectivity {
  return current;
}

/**
 * Decisão usada antes de disparar requisição: só considera offline quando o
 * NetInfo tem certeza. Falso-positivo de "online" custa um timeout; um
 * falso-positivo de "offline" bloquearia o app inteiro sem motivo.
 */
export function isProbablyOnline(state: Connectivity = current): boolean {
  if (!state.isConnected) return false;
  return state.isInternetReachable !== false;
}

export function subscribeConnectivity(
  listener: (state: Connectivity) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Força uma nova checagem (usado no "tentar novamente" das telas). */
export async function refreshConnectivity(): Promise<Connectivity> {
  const state = await NetInfo.fetch();
  current = toConnectivity(state);
  listeners.forEach((listener) => listener(current));
  return current;
}
