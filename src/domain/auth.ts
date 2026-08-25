import { z } from "zod";

import { apiRequest } from "@/lib/api";

export type Role = "ADMIN" | "MANAGER" | "TECHNICIAN" | "PRODUCER";

export const ROLES: Role[] = ["ADMIN", "MANAGER", "TECHNICIAN", "PRODUCER"];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  TECHNICIAN: "Técnico",
  PRODUCER: "Produtor",
};

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  cpf: string;
  role: Role;
  dateOfBirth: string | null;
};

/** `LoginResponseDTO` do backend — o campo do usuário se chama assim mesmo. */
export type LoginResponse = {
  token: string;
  userResponseDTO: AuthUser;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail")
    .refine((value) => EMAIL_PATTERN.test(value), "E-mail inválido"),
  password: z.string().min(8, "A senha tem no mínimo 8 caracteres"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export function login(input: LoginInput): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
}

/** Revalida a sessão contra a API (`GET /auth/me`). */
export function fetchCurrentUser(): Promise<AuthUser> {
  return apiRequest<AuthUser>("/auth/me", { method: "GET" });
}

/**
 * Lê o `exp` do JWT sem verificar assinatura — serve só para saber quando
 * parar de tentar usar o token (o backend emite tokens de 4 h). Validar de
 * verdade é responsabilidade da API.
 */
export function readTokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const json = decodeBase64Url(payload);
    const claims = JSON.parse(json) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) return false;
  return Date.now() >= expiresAt;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodificador base64url próprio: `atob` não existe em todos os motores JS
 * usados pelo React Native, e trazer uma dependência só para ler um claim
 * não se paga.
 */
function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");

  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];

  for (const char of base64) {
    if (char === "=") break;
    const index = BASE64_ALPHABET.indexOf(char);
    if (index === -1) continue;

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return decodeUtf8(bytes);
}

function decodeUtf8(bytes: number[]): string {
  let result = "";

  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;

    if (byte < 0x80) {
      result += String.fromCharCode(byte);
    } else if (byte >= 0xc0 && byte < 0xe0) {
      const next = bytes[i + 1] ?? 0;
      result += String.fromCharCode(((byte & 0x1f) << 6) | (next & 0x3f));
      i += 1;
    } else if (byte >= 0xe0 && byte < 0xf0) {
      const b1 = bytes[i + 1] ?? 0;
      const b2 = bytes[i + 2] ?? 0;
      result += String.fromCharCode(
        ((byte & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
      );
      i += 2;
    } else {
      // Fora do BMP: não aparece em claim de JWT, ignora com segurança.
      i += 3;
    }
  }

  return result;
}
