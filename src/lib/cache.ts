import { readJson, removeKey, StorageKeys, writeJson } from "@/lib/storage";

export type CacheEntry<T> = {
  data: T;
  cachedAt: number;
};

/**
 * Chaves de cache por recurso. Centralizadas para que a invalidação após uma
 * mutação (inclusive a que veio do outbox) não precise adivinhar strings.
 */
export const CacheKeys = {
  myFarmer: "farmer:me",
  farmers: (communityId?: string) =>
    communityId ? `farmers:community:${communityId}` : "farmers:all",
  /** Agricultores atribuídos ao técnico logado — recorte diferente de `farmers`. */
  assignedFarmers: "farmers:assigned",
  plans: (farmerId: string) => `plans:farmer:${farmerId}`,
  plan: (planId: string) => `plan:${planId}`,
  executions: (planId: string) => `executions:plan:${planId}`,
  comparison: (planId: string) => `comparison:plan:${planId}`,
  crops: "crops",
  harvests: "harvests",
} as const;

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  return readJson<CacheEntry<T>>(StorageKeys.cache(key));
}

export async function writeCache<T>(
  key: string,
  data: T,
): Promise<CacheEntry<T>> {
  const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
  await writeJson(StorageKeys.cache(key), entry);
  return entry;
}

export async function dropCache(...keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => removeKey(StorageKeys.cache(key))));
}

/**
 * Notifica as telas montadas de que um recurso mudou (após sincronizar o
 * outbox, por exemplo), para que releiam sem depender de um "puxar para
 * atualizar" manual.
 */
type Invalidation = (keys: string[]) => void;
const invalidationListeners = new Set<Invalidation>();

export function subscribeInvalidation(listener: Invalidation): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

export function notifyInvalidation(keys: string[]): void {
  invalidationListeners.forEach((listener) => listener(keys));
}
