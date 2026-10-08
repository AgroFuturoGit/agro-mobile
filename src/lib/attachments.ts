import { Directory, File, Paths, UploadType } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { ApiError, getApiBaseUrl, getAuthToken, OfflineError } from "@/lib/api";

/**
 * Uma foto já guardada no aparelho, pronta para subir quando houver rede.
 *
 * `uri` aponta para o diretório do aplicativo, não para o cache: o arquivo
 * precisa sobreviver ao fechamento do app e à limpeza que o sistema faz do
 * cache, porque entre tirar a foto em campo e conseguir sinal podem passar
 * dias.
 */
export type Attachment = {
  /**
   * Identificador gerado aqui, antes do primeiro envio.
   *
   * É o que torna o upload seguro para repetir: se a resposta se perder na
   * rede depois de o servidor já ter gravado, a tentativa seguinte chega com
   * a mesma chave e recebe de volta o anexo existente, em vez de criar outro.
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
 * Largura máxima da imagem guardada.
 *
 * A câmera de um celular comum entrega algo em torno de 4000 px e 4 MB. Isso
 * é resolução muito além do que comprova uma praga ou uma nota fiscal, e o
 * custo aparece duas vezes: no armazenamento do aparelho, que é escasso, e no
 * upload, feito por rede móvel instável. 1280 px mantém o detalhe legível e
 * derruba o arquivo para a casa das centenas de kB.
 */
const MAX_WIDTH = 1280;

/** Qualidade do JPEG após o redimensionamento. */
const COMPRESSION = 0.6;

const MIME_TYPE = "image/jpeg";

/**
 * Onde os anexos ficam até serem enviados.
 *
 * Subdiretório próprio, e não a raiz do diretório do app, para que a coleta
 * de lixo saiba exatamente o que lhe pertence.
 */
function attachmentsDirectory(): Directory {
  const dir = new Directory(Paths.document, "attachments");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * UUID v4 a partir de `Math.random`.
 *
 * Não é aleatoriedade criptográfica, e aqui não precisa ser: este valor é uma
 * chave de deduplicação dentro de um apontamento, não um segredo. Evita
 * acrescentar dependência para gerar um identificador.
 */
function randomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Comprime a foto recém-tirada e a move para o diretório do aplicativo.
 *
 * A câmera entrega o arquivo no cache, que o sistema pode esvaziar a qualquer
 * momento. Enquanto a foto não subiu, ela é o próprio registro — perder o
 * arquivo é perder a comprovação que o agricultor foi até o talhão fazer.
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
 * Apaga o arquivo local do anexo.
 *
 * Nunca lança: é chamada tanto quando o usuário remove a foto antes de salvar
 * quanto depois de o servidor confirmar o recebimento. Em nenhum dos dois
 * casos uma falha de escrita pode derrubar o fluxo — no segundo, o dado já
 * está salvo no servidor, e o pior resultado é um arquivo órfão.
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
 * Sobe a imagem para a API em `multipart/form-data`.
 *
 * Não passa por `apiRequest` de propósito: ali o corpo é serializado em JSON,
 * e carregar uma foto para a memória só para convertê-la em texto é o caminho
 * mais rápido para estourar a memória de um aparelho modesto. `File.upload`
 * faz o envio no lado nativo, lendo o arquivo em fluxo.
 *
 * Em compensação, o tratamento de erro precisa ser refeito aqui: a função
 * devolve o status em vez de lançar. Traduzir de volta para `ApiError` e
 * `OfflineError` é o que permite à fila reaproveitar, sem mudança, a lógica
 * que já distingue conflito, recusa e falha de servidor.
 */
export async function uploadAttachment(
  attachment: Attachment,
  path: string,
): Promise<unknown> {
  const file = new File(attachment.uri);

  if (!file.exists) {
    // O arquivo sumiu — cache limpo pelo sistema, usuário apagou pelo gerenciador
    // de arquivos. Reenviar não resolve, então vale como recusa definitiva.
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
