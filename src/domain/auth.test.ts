import {
  isExpired,
  loginSchema,
  readTokenExpiry,
  ROLE_LABELS,
} from "@/domain/auth";

/** Monta um JWT de verdade (só o payload importa — a assinatura é ignorada). */
function tokenWith(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.assinatura`;
}

describe("readTokenExpiry", () => {
  it("converte o `exp` do JWT para milissegundos", () => {
    const token = tokenWith({ sub: "user@exemplo.com", exp: 1_893_456_000 });

    expect(readTokenExpiry(token)).toBe(1_893_456_000_000);
  });

  /**
   * O decodificador base64url é próprio: `atob` não existe em todos os motores
   * JS do React Native. Um payload com acento prova que a leitura UTF-8 está
   * correta — se estivesse errada, o `JSON.parse` falharia e o retorno viria
   * nulo, e o app trataria uma sessão válida como expirada.
   */
  it("lê payload com caracteres acentuados", () => {
    const token = tokenWith({
      sub: "José da Silva — Sítio Boa Esperança",
      exp: 1_800_000_000,
    });

    expect(readTokenExpiry(token)).toBe(1_800_000_000_000);
  });

  it("devolve nulo quando não há `exp`", () => {
    expect(readTokenExpiry(tokenWith({ sub: "sem-exp" }))).toBeNull();
  });

  it("devolve nulo para token malformado", () => {
    expect(readTokenExpiry("nao-e-um-jwt")).toBeNull();
    expect(readTokenExpiry("cabecalho.payload-invalido.assinatura")).toBeNull();
  });
});

describe("isExpired", () => {
  it("considera vencido um instante no passado", () => {
    expect(isExpired(Date.now() - 1_000)).toBe(true);
  });

  it("considera válido um instante no futuro", () => {
    expect(isExpired(Date.now() + 60_000)).toBe(false);
  });

  /**
   * Sem `exp` legível não há motivo para expulsar o usuário: quem decide de
   * verdade é a API. Tratar como expirado tiraria do ar um app que funcionaria.
   */
  it("não expira sessão sem data conhecida", () => {
    expect(isExpired(null)).toBe(false);
  });
});

describe("loginSchema", () => {
  it("aceita credenciais válidas", () => {
    const result = loginSchema.safeParse({
      email: "admin@admin.com",
      password: "12345678",
    });

    expect(result.success).toBe(true);
  });

  it("remove espaços em volta do e-mail", () => {
    const result = loginSchema.safeParse({
      email: "  admin@admin.com  ",
      password: "12345678",
    });

    expect(result.success && result.data.email).toBe("admin@admin.com");
  });

  it("recusa e-mail sem domínio", () => {
    const result = loginSchema.safeParse({
      email: "admin@",
      password: "12345678",
    });

    expect(result.success).toBe(false);
  });

  it("exige a senha mínima que o backend valida", () => {
    const result = loginSchema.safeParse({
      email: "admin@admin.com",
      password: "1234567",
    });

    expect(result.success).toBe(false);
  });
});

describe("ROLE_LABELS", () => {
  it("cobre os quatro papéis do backend", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([
      "ADMIN",
      "MANAGER",
      "PRODUCER",
      "TECHNICIAN",
    ]);
  });
});
