/**
 * Formatadores pt-BR sem depender de `Intl`.
 *
 * O suporte a `Intl` varia entre Hermes/JSC e versões de Android, e número
 * errado numa tela de produção agrícola é pior do que feio — então a
 * formatação é feita à mão.
 */

export function formatNumber(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "—";

  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [intPart = "0", decPart] = fixed.split(".");

  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmedDec = decPart?.replace(/0+$/, "");

  const body = trimmedDec ? `${withSeparators},${trimmedDec}` : withSeparators;
  return negative ? `-${body}` : body;
}

/** `yyyy-MM-dd` (LocalDate do backend) → `dd/MM/yyyy`, sem shift de fuso. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDate(toIsoDate(date));
}

export function formatDateTime(value: number | string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${formatDate(toIsoDate(date))} às ${time}`;
}

/** Data local do aparelho como `yyyy-MM-dd` (formato aceito pela API). */
export function toIsoDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Aceita `dd/MM/yyyy` ou `yyyy-MM-dd` e devolve `yyyy-MM-dd` — ou null. */
export function parseDateInput(input: string): string | null {
  const trimmed = input.trim();

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (br) {
    const [, day, month, year] = br;
    return isRealDate(`${year}-${month}-${day}`) ? `${year}-${month}-${day}` : null;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return isRealDate(trimmed) ? trimmed : null;

  return null;
}

function isRealDate(iso: string): boolean {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** Aceita vírgula decimal (teclado pt-BR) além do ponto. */
export function parseDecimal(input: string): number | null {
  const normalized = input.trim().replace(/\./g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** "há 3 min", "há 2 h" — usado para indicar a idade do dado em cache. */
export function formatRelative(timestamp: number | null): string {
  if (!timestamp) return "—";

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "agora há pouco";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  return `em ${formatDate(toIsoDate(new Date(timestamp)))}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
