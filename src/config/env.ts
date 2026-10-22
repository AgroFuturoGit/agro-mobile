import Constants from "expo-constants";

/** Porta do agro-backend; sobrescrita em `app.json` → `expo.extra.apiPort`. */
const DEFAULT_API_PORT = Number(Constants.expoConfig?.extra?.apiPort) || 8080;

const FALLBACK_API_URL = `http://localhost:${DEFAULT_API_PORT}`;

/**
 * IP da máquina que serve o bundle do Metro.
 *
 * No Expo Go o app roda no celular, então `localhost` seria o próprio
 * aparelho — nunca o backend no notebook. O `hostUri` dá o IP certo.
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
 * URL base da API: `EXPO_PUBLIC_API_URL`, senão o IP do Metro, senão
 * localhost. O endereço gravado pela tela de Perfil vence todos (`api.ts`).
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

/** Rede de campo cai devagar; não vale esperar além disso. */
export const REQUEST_TIMEOUT_MS = 15_000;
