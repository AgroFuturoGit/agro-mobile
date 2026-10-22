import { isOfflineError } from "@/lib/api";
import { notifyInvalidation } from "@/lib/cache";
import { getConnectivity, isProbablyOnline } from "@/lib/net";
import { enqueue, type OutboxEntry } from "@/lib/outbox";

export type MutationResult<T> = {
  /** `true` quando a API confirmou; `false` quando ficou na fila offline. */
  synced: boolean;
  data: T | null;
  entry: OutboxEntry | null;
};

type MutationInput<T> = {
  request: () => Promise<T>;
  /** Como enfileirar a operação se não houver conexão. */
  queue: Omit<
    OutboxEntry,
    "id" | "createdAt" | "attempts" | "lastError" | "status"
  > & { id?: string };
};

/**
 * Executa a mutação agora, ou guarda na fila para quando houver rede.
 *
 * Erro de validação (`ApiError`) sobe para a tela: enfileirar um dado que o
 * servidor já recusou só adiaria o problema. Apenas a falta de resposta vira
 * item de fila.
 */
export async function mutate<T>({
  request,
  queue,
}: MutationInput<T>): Promise<MutationResult<T>> {
  if (isProbablyOnline(getConnectivity())) {
    try {
      const data = await request();
      // Avisa quem está na tela sem apagar o cache: apagar faria a tela
      // piscar vazia, e ficar vazia se a releitura falhasse.
      notifyInvalidation(queue.invalidates);
      return { synced: true, data, entry: null };
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      // Caiu a rede no meio: segue para a fila.
    }
  }

  const entry = await enqueue(queue);
  notifyInvalidation(queue.invalidates);
  return { synced: false, data: null, entry };
}
