import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

export type Connectivity = {
  /** Há interface de rede ativa. */
  isConnected: boolean;
  /** `null` enquanto o NetInfo sonda; aí vale como "provavelmente online". */
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
 * Só considera offline quando o NetInfo tem certeza: errar para "online"
 * custa um timeout; errar para "offline" bloquearia o app sem motivo.
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
