import {
  formatCpf,
  formatDate,
  formatNumber,
  parseDateInput,
  parseDecimal,
  toIsoDate,
} from "@/lib/format";

/**
 * A formatação é feita à mão porque o suporte a `Intl` varia entre Hermes/JSC
 * e versões de Android. Número errado numa tela de produção agrícola vira
 * decisão errada — daí a cobertura.
 */
describe("formatNumber", () => {
  it("usa vírgula decimal e ponto de milhar", () => {
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatNumber(1_000_000)).toBe("1.000.000");
  });

  it("descarta zeros decimais à direita", () => {
    expect(formatNumber(10)).toBe("10");
    expect(formatNumber(10.5)).toBe("10,5");
    expect(formatNumber(10.25)).toBe("10,25");
  });

  it("preserva o sinal negativo", () => {
    expect(formatNumber(-1234.5)).toBe("-1.234,5");
  });

  it("não inventa número para valor inválido", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatDate", () => {
  it("converte a LocalDate do backend sem deslocar o fuso", () => {
    // Com `new Date("2026-08-01")` o fuso do Brasil jogaria para 31/07.
    expect(formatDate("2026-08-01")).toBe("01/08/2026");
  });

  it("aceita data com hora", () => {
    expect(formatDate("2026-08-01T13:45:00")).toBe("01/08/2026");
  });

  it("representa ausência de data", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });
});

describe("parseDateInput", () => {
  it("aceita o formato digitado pelo usuário", () => {
    expect(parseDateInput("01/08/2026")).toBe("2026-08-01");
  });

  it("aceita o formato da API", () => {
    expect(parseDateInput("2026-08-01")).toBe("2026-08-01");
  });

  it("recusa data que não existe no calendário", () => {
    expect(parseDateInput("31/02/2026")).toBeNull();
    expect(parseDateInput("2026-02-31")).toBeNull();
  });

  it("recusa entrada fora de formato", () => {
    expect(parseDateInput("1/8/26")).toBeNull();
    expect(parseDateInput("amanhã")).toBeNull();
  });
});

describe("parseDecimal", () => {
  it("aceita vírgula do teclado pt-BR", () => {
    expect(parseDecimal("12,5")).toBe(12.5);
  });

  it("aceita ponto decimal", () => {
    expect(parseDecimal("12.5")).toBe(12.5);
  });

  it("aceita valor com separador de milhar", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1.234")).toBe(1234);
    expect(parseDecimal("1.234.567")).toBe(1234567);
  });

  /**
   * Regressão: o ponto era removido sem olhar o contexto, então `12.5` virava
   * `125` — dez vezes mais colheita do que o produtor apontou, gravado sem
   * nenhum aviso na tela.
   */
  it("não confunde ponto decimal com separador de milhar", () => {
    expect(parseDecimal("12.5")).toBe(12.5);
    expect(parseDecimal("0.75")).toBe(0.75);
    expect(parseDecimal("12.50")).toBe(12.5);
  });

  it("recusa texto e vazio", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("muito")).toBeNull();
  });
});

describe("toIsoDate", () => {
  it("usa a data local do aparelho, não UTC", () => {
    // 1º de janeiro às 2h no fuso local: em UTC ainda seria 31/12.
    const local = new Date(2026, 0, 1, 2, 0, 0);

    expect(toIsoDate(local)).toBe("2026-01-01");
  });
});

describe("formatCpf", () => {
  it("aplica a máscara", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });

  it("devolve o valor original quando não tem 11 dígitos", () => {
    expect(formatCpf("123")).toBe("123");
  });

  it("representa ausência", () => {
    expect(formatCpf(null)).toBe("—");
  });
});
