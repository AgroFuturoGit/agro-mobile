import { Directory, File, Paths, UploadType } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { ApiError, getApiBaseUrl, getAuthToken, OfflineError } from "@/lib/api";

/**
 * Foto guardada no aparelho, à espera de rede. Fica no diretório do app e não
 * no cache: entre fotografar em campo e ter sinal podem passar dias, e o
 * sistema esvazia o cache quando quer.
 */
export type Attachment = {
  /**
   * Gerado antes do primeiro envio: se a resposta se perder depois de o
   * servidor gravar, o reenvio recebe o anexo existente em vez de criar outro.
   */
  clientId: string;
  uri: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
};

/** Espelha o teto do backend (`UploadExecutionAttachmentUseCase`). */
export const MAX_ATTACHMENTS_PER_EXECUTION = 5;

/**
 * A câmera entrega perto de 4000 px e 4 MB — muito além do que comprova uma
 * praga, e caro duas vezes: no armazenamento e no upload por rede móvel.
 */
const MAX_WIDTH = 1280;

/** Qualidade do JPEG após o redimensionamento. */
const COMPRESSION = 0.6;

const MIME_TYPE = "image/jpeg";

/** Subdiretório próprio, para que a coleta de lixo saiba o que lhe pertence. */
function attachmentsDirectory(): Directory {
  const dir = new Directory(Paths.document, "attachments");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Chave de deduplicação, não segredo — `Math.random` basta e evita dependência. */
function randomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Comprime e move para o diretório do app. A câmera entrega no cache, que o
 * sistema esvazia quando quer — e até subir, a foto é a própria comprovação.
 */
export async function persistCapturedPhoto(
  sourceUri: string,
): Promise<Attachment> {
  const context = ImageManipulator.manipulate(sourceUri);
  context.resize({ width: MAX_WIDTH });

  const rendered = await context.renderAsync();
  const compressed = await rendered.saveAsync({
    compress: COMPRESSION,
    format: SaveFormat.JPEG,
  });

  const clientId = randomUuid();
  const filename = `${clientId}.jpg`;

  const origem = new File(compressed.uri);
  const destino = new File(attachmentsDirectory(), filename);
  origem.moveSync(destino);

  return {
    clientId,
    uri: destino.uri,
    filename,
    mimeType: MIME_TYPE,
    sizeBytes: destino.size,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Nunca lança: falha de escrita não pode derrubar o fluxo nem ao remover antes
 * de salvar, nem depois do aceite — ali o pior resultado é um arquivo órfão.
 */
export function discardAttachmentFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Arquivo já removido, ou sem permissão. Não há o que fazer nem o que dizer.
  }
}

/**
 * Sobe em `multipart/form-data` por fora do `apiRequest`: ali o corpo vira
 * JSON, e carregar a foto na memória para convertê-la em texto estoura a
 * memória de um aparelho modesto. `File.upload` envia em fluxo pelo nativo.
 *
 * O preço é refazer o erro aqui: ele devolve status em vez de lançar, e a
 * tradução para `ApiError`/`OfflineError` é o que deixa a fila reaproveitar
 * sem mudança a lógica de conflito, recusa e falha de servidor.
 */
export async function uploadAttachment(
  attachment: Attachment,
  path: string,
): Promise<unknown> {
  const file = new File(attachment.uri);

  if (!file.exists) {
    // Sumiu do disco: reenviar não resolve, então vale como recusa definitiva.
    throw new ApiError(422, "A foto não está mais salva no aparelho.", null);
  }

  const token = getAuthToken();

  let result: { body: string; status: number };
  try {
    result = await file.upload(`${getApiBaseUrl()}${path}`, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: attachment.mimeType,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (error) {
    throw new OfflineError("Não foi possível enviar a foto.", error);
  }

  const payload = parseBody(result.body);

  if (result.status < 200 || result.status >= 300) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Erro ${result.status}`;
    throw new ApiError(result.status, message, payload);
  }

  return payload;
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
