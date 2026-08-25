import {
  REQUEST_TIMEOUT_MS,
  resolveDefaultApiUrl,
  stripTrailingSlash,
} from "@/config/env";
import { getConnectivity, isProbablyOnline } from "@/lib/net";
import { readJson, removeKey, StorageKeys, writeJson } from "@/lib/storage";

/** Erro devolvido pela API (status HTTP + corpo). Espelha o `ApiError` da web. */
export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Não houve resposta do servidor: sem rede, servidor fora do ar ou timeout.
 * É o sinal que o cache e o outbox usam para decidir operar offline.
 */
export class OfflineError extends Error {
  cause?: unknown;

  constructor(message = "Sem conexão com o servidor.", cause?: unknown) {
    super(message);
    this.name = "OfflineError";
    this.cause = cause;
  }
}

export function isOfflineError(error: unknown): error is OfflineError {
  return error instanceof OfflineError;
}

// ----- URL base (env + override persistido pela tela de Perfil) -----

let apiBaseUrl = resolveDefaultApiUrl();

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

export function getDefaultApiBaseUrl(): string {
  return resolveDefaultApiUrl();
}

/** Carrega o override salvo pelo usuário. Chamado uma vez no boot. */
export async function initApiBaseUrl(): Promise<string> {
  const override = await readJson<string>(StorageKeys.apiBaseUrl);
  if (override) apiBaseUrl = stripTrailingSlash(override);
  return apiBaseUrl;
}

export async function setApiBaseUrl(url: string | null): Promise<string> {
  if (!url || !url.trim()) {
    await removeKey(StorageKeys.apiBaseUrl);
    apiBaseUrl = resolveDefaultApiUrl();
    return apiBaseUrl;
  }
  apiBaseUrl = stripTrailingSlash(url.trim());
  await writeJson(StorageKeys.apiBaseUrl, apiBaseUrl);
  return apiBaseUrl;
}

// ----- Injeção de sessão -----
//
// O token vive na camada de auth. Injetá-lo aqui (em vez de importar o
// contexto) evita ciclo de imports e mantém `apiRequest` utilizável fora da
// árvore React — o flush do outbox roda sem componente montado.

let tokenProvider: () => string | null = () => null;
let unauthorizedHandler: () => void = () => {};

export function setTokenProvider(provider: () => string | null): void {
  tokenProvider = provider;
}

export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
  /** Ignora a checagem de conectividade (usado pelo flush do outbox). */
  force?: boolean;
  timeoutMs?: number;
};

export async function apiRequest<T = unknown>(
  path: string,
  {
    body,
    auth = true,
    force = false,
    timeoutMs = REQUEST_TIMEOUT_MS,
    headers,
    ...rest
  }: RequestOptions = {},
): Promise<T> {
  if (!force && !isProbablyOnline(getConnectivity())) {
    throw new OfflineError("Aparelho sem conexão.");
  }

  const finalHeaders = new Headers(headers);
  if (body !== undefined && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = tokenProvider();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    // `fetch` só rejeita por falha de transporte ou abort — nos dois casos o
    // servidor não respondeu, então é indistinguível de estar offline.
    throw new OfflineError(
      controller.signal.aborted
        ? "O servidor demorou demais para responder."
        : "Não foi possível falar com o servidor.",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    // Só 401 significa "credencial inválida". O backend usa 403 para negar
    // por papel (`@PreAuthorize`) — derrubar a sessão nesse caso expulsaria
    // um usuário perfeitamente autenticado.
    if (response.status === 401) {
      unauthorizedHandler();
    }
    const message =
      (isJson && payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : null) ?? `Erro ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}

/**
 * Erros de validação do backend chegam concatenados:
 * `"email: não pode ser vazio; password: tamanho mínimo 8"`.
 * Mesma convenção da web (`parseCropFieldErrors` etc.).
 */
export function parseFieldErrors(payload: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!payload || typeof payload !== "object") return errors;

  const record = payload as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  if (!message) return errors;

  for (const part of message.split(";")) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const field = part.slice(0, colonIdx).trim();
    const msg = part.slice(colonIdx + 1).trim();
    if (field && msg) errors[field] = msg;
  }

  return errors;
}
