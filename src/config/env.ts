import Constants from "expo-constants";

/**
 * Porta padrão do agro-backend (Spring Boot). Pode ser sobrescrita em
 * `app.json` → `expo.extra.apiPort`.
 */
const DEFAULT_API_PORT = Number(Constants.expoConfig?.extra?.apiPort) || 8080;

const FALLBACK_API_URL = `http://localhost:${DEFAULT_API_PORT}`;

/**
 * Extrai o IP da máquina que está servindo o bundle do Metro.
 *
 * No Expo Go o app roda no celular, então `localhost` aponta para o próprio
 * aparelho — nunca para o backend rodando no notebook. O `hostUri` do Expo
 * (ex.: `192.168.0.12:8081`) dá justamente o IP da máquina de desenvolvimento,
 * então derivar a URL da API dele faz o app funcionar sem configuração manual.
 */
function hostFromExpoGo(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    null;

  if (!hostUri) return null;

  const host = hostUri.split("/")[0]?.split(":")[0];
  if (!host || host === "localhost" || host === "127.0.0.1") return null;

  return host;
}

/**
 * URL base da API, na ordem de precedência:
 *
 * 1. `EXPO_PUBLIC_API_URL` (arquivo `.env`) — controle explícito;
 * 2. IP da máquina do Metro + porta do backend — funciona no Expo Go;
 * 3. `http://localhost:8080` — emulador/web.
 *
 * Um override gravado em runtime pela tela de Perfil tem prioridade sobre
 * tudo isso (ver `getApiBaseUrl` em `src/lib/api.ts`).
 */
export function resolveDefaultApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);

  const host = hostFromExpoGo();
  if (host) return `http://${host}:${DEFAULT_API_PORT}`;

  return FALLBACK_API_URL;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Timeout das requisições. Rede de campo cai devagar — não vale esperar. */
export const REQUEST_TIMEOUT_MS = 15_000;
