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
  /** Chamada real à API. */
  request: () => Promise<T>;
  /** Como a operação deve ser enfileirada caso não haja conexão. */
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
      // Só avisa quem está na tela: o cache antigo continua no lugar até a
      // releitura chegar. Apagá-lo aqui faria a tela piscar vazia — e ficar
      // vazia de vez se a releitura falhasse.
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
