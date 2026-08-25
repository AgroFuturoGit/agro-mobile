import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Prefixo com versão: subir a versão invalida todo o cache local de uma vez
 * quando o shape dos dados mudar.
 */
const NAMESPACE = "produplan:v1";

export const StorageKeys = {
  user: `${NAMESPACE}:auth:user`,
  sessionExpiresAt: `${NAMESPACE}:auth:expires-at`,
  apiBaseUrl: `${NAMESPACE}:config:api-base-url`,
  outbox: `${NAMESPACE}:outbox`,
  cache: (key: string) => `${NAMESPACE}:cache:${key}`,
} as const;

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Registro corrompido não pode derrubar o app: trata como ausente.
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Disco cheio / quota: perder cache é aceitável, quebrar o fluxo não.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // idem
  }
}

/** Remove todas as entradas de cache, preservando sessão e outbox. */
export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((key) =>
      key.startsWith(`${NAMESPACE}:cache:`),
    );
    if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
  } catch {
    // idem
  }
}
