export type TankIdParts = {
  prefix: string;
  number: number;
};

export type TankIdModel = TankIdParts & {
  canonicalTankId: string;
  displayTankId: string;
  sortKey: string;
};

export type TankIdValidationResult =
  | {
      ok: true;
      input: string;
      normalizedInput: string;
      parts: TankIdParts;
      canonicalTankId: string;
      displayTankId: string;
      sortKey: string;
    }
  | {
      ok: false;
      input: string;
      normalizedInput: string;
      reason: string;
    };

const MIN_DISPLAY_DIGITS = 2;
const SORT_KEY_DIGITS = 6;
const HYPHEN_VARIANTS_RE = /[‐‑‒–—―ーｰ−]/g;
// Prefix is intentionally one or more ASCII letters so future multi-letter prefixes like AB-01 remain valid.
const TANK_ID_RE = /^([A-Z]+)-?([0-9]+)$/;
const PREFIX_RE = /^[A-Z]+$/;

/**
 * Tank IDs are modeled as prefix + numeric value.
 * "01" is a display/input representation, not stored source data.
 */
export function parseTankId(input: string): TankIdParts {
  const result = tryParseTankId(input);
  if (result.ok === false) {
    throw new Error(result.reason);
  }
  return result.parts;
}

export function tryParseTankId(input: string): TankIdValidationResult {
  const normalizedInput = normalizeInputForParse(input);
  if (!normalizedInput) {
    return invalid(input, normalizedInput, "タンクIDを入力してください");
  }

  const match = normalizedInput.match(TANK_ID_RE);
  if (!match) {
    return invalid(input, normalizedInput, "タンクIDは prefix + number の形式で入力してください");
  }

  const prefix = match[1];
  const numberText = match[2];
  const number = Number.parseInt(numberText, 10);

  if (!Number.isSafeInteger(number) || number < 1) {
    return invalid(input, normalizedInput, "タンクIDの番号は1以上で入力してください");
  }

  const parts: TankIdParts = { prefix, number };
  const canonicalTankId = formatTankId(parts);
  return {
    ok: true,
    input,
    normalizedInput,
    parts,
    canonicalTankId,
    displayTankId: canonicalTankId,
    sortKey: buildTankSortKey(parts),
  };
}

export function normalizeTankId(input: string): string {
  return formatTankId(parseTankId(input));
}

export function formatTankId(parts: TankIdParts): string;
export function formatTankId(prefix: string, number: number): string;
export function formatTankId(
  partsOrPrefix: TankIdParts | string,
  numberArg?: number,
): string {
  const parts =
    typeof partsOrPrefix === "string"
      ? { prefix: partsOrPrefix, number: numberArg }
      : partsOrPrefix;
  const prefix = normalizePrefix(parts.prefix);
  const number = normalizeNumber(parts.number);
  return `${prefix}-${String(number).padStart(MIN_DISPLAY_DIGITS, "0")}`;
}

export function buildTankSortKey(parts: TankIdParts): string;
export function buildTankSortKey(prefix: string, number: number): string;
export function buildTankSortKey(
  partsOrPrefix: TankIdParts | string,
  numberArg?: number,
): string {
  const parts =
    typeof partsOrPrefix === "string"
      ? { prefix: partsOrPrefix, number: numberArg }
      : partsOrPrefix;
  const prefix = normalizePrefix(parts.prefix);
  const number = normalizeNumber(parts.number);
  return `${prefix}:${String(number).padStart(SORT_KEY_DIGITS, "0")}`;
}

export function compareTankIdNatural(a: string, b: string): number {
  // Invalid values throw through parseTankId. UI callers that need tolerant sorting should filter first.
  const left = parseTankId(a);
  const right = parseTankId(b);
  const prefixOrder = left.prefix.localeCompare(right.prefix);
  if (prefixOrder !== 0) return prefixOrder;
  return left.number - right.number;
}

export function validateTankId(input: string): TankIdValidationResult {
  return tryParseTankId(input);
}

function normalizeInputForParse(input: string): string {
  return String(input ?? "")
    .trim()
    .replace(HYPHEN_VARIANTS_RE, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizePrefix(prefix: string): string {
  const normalized = String(prefix ?? "").trim().toUpperCase();
  if (!PREFIX_RE.test(normalized)) {
    throw new Error("タンクIDのprefixは英字1文字以上で入力してください");
  }
  return normalized;
}

function normalizeNumber(number: unknown): number {
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    throw new Error("タンクIDの番号は1以上で入力してください");
  }
  return number;
}

function invalid(
  input: string,
  normalizedInput: string,
  reason: string,
): TankIdValidationResult {
  return {
    ok: false,
    input,
    normalizedInput,
    reason,
  };
}
