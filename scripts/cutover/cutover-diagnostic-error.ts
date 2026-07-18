const CUTOVER_DIAGNOSTIC_CODES = [
  "RESET_ARGUMENTS_INVALID",
  "RESET_INTENT_INVALID",
  "RESET_EXECUTION_GATE_FAILED",
  "RESET_SNAPSHOT_INPUT_FAILED",
  "DATA_CREDENTIAL_VERIFICATION_FAILED",
  "DATA_CREDENTIAL_TOKEN_FAILED",
  "FIRESTORE_COMMIT_HTTP_4XX",
  "FIRESTORE_COMMIT_HTTP_5XX",
  "FIRESTORE_COMMIT_HTTP_OTHER",
  "FIRESTORE_COMMIT_TRANSPORT_AMBIGUOUS",
  "FIRESTORE_COMMIT_RESPONSE_INVALID",
  "RESET_PLAN_FAILED",
  "RESET_AUTHORIZATION_FAILED",
  "RESET_COMMIT_NOT_OBSERVED",
  "RESET_COMMIT_STATE_UNKNOWN",
  "RESET_POST_VERIFY_FAILED",
] as const;
const CUTOVER_DIAGNOSTIC_CODE_SET = new Set<string>(CUTOVER_DIAGNOSTIC_CODES);

export type CutoverDiagnosticCode = typeof CUTOVER_DIAGNOSTIC_CODES[number];

type CutoverDiagnosticErrorOptions = {
  cause?: unknown;
  causeCode?: string;
};

/**
 * 本番cutoverの失敗段階だけを、安全な固定codeとして上位へ伝える。
 * 原因のmessageやHTTP bodyは保持しても、CLIへは出力しない。
 */
export class CutoverDiagnosticError extends Error {
  readonly code: CutoverDiagnosticCode;
  readonly causeCode?: string;

  constructor(
    code: CutoverDiagnosticCode,
    options: CutoverDiagnosticErrorOptions = {},
  ) {
    assertSafeCutoverErrorCode(code);
    super("cutover diagnostic failure", options.cause === undefined
      ? undefined
      : { cause: options.cause });
    this.name = "CutoverDiagnosticError";
    this.code = code;

    const causeCode = options.causeCode ?? firstSafeCauseCode(options.cause);
    if (causeCode && CUTOVER_DIAGNOSTIC_CODE_SET.has(causeCode)) {
      this.causeCode = causeCode;
    }
  }
}

/** 元errorをcauseとして保持しつつ、安全な診断codeを付ける。 */
export function withCutoverDiagnosticCode(
  error: unknown,
  code: CutoverDiagnosticCode,
): CutoverDiagnosticError {
  return new CutoverDiagnosticError(code, {
    cause: error,
    causeCode: firstSafeCauseCode(error) ?? undefined,
  });
}

/**
 * CLIへ公開可能な固定allowlistのcodeだけを返す。
 * AggregateErrorでは、外側の明示codeを優先し、なければerrors内の最初の
 * 明示codeだけを採用する。
 */
export function safeCutoverErrorCode(error: unknown): string | null {
  return firstSafeErrorCode(error, new Set<object>());
}

export function safeCutoverCauseCode(error: unknown): string | null {
  if (!isObject(error)) return null;
  const explicitCauseCode = readSafeCodeProperty(error, "causeCode");
  if (explicitCauseCode) return explicitCauseCode;
  return firstSafeCauseCode(error);
}

function firstSafeCauseCode(error: unknown): string | null {
  if (!isObject(error)) return null;
  const visited = new Set<object>();
  visited.add(error);

  const directCode = readSafeCodeProperty(error, "code");
  if (directCode) return directCode;

  const cause = readUnknownProperty(error, "cause");
  const causeCode = firstSafeErrorCode(cause, visited);
  if (causeCode) return causeCode;

  if (error instanceof AggregateError) {
    for (const nestedError of error.errors) {
      const nestedCode = firstSafeErrorCode(nestedError, visited);
      if (nestedCode) return nestedCode;
    }
  }
  return null;
}

function firstSafeErrorCode(error: unknown, visited: Set<object>): string | null {
  if (!isObject(error) || visited.has(error)) return null;
  visited.add(error);

  const directCode = readSafeCodeProperty(error, "code");
  if (directCode) return directCode;

  if (error instanceof AggregateError) {
    for (const nestedError of error.errors) {
      const nestedCode = firstSafeErrorCode(nestedError, visited);
      if (nestedCode) return nestedCode;
    }
  }
  return null;
}

function readSafeCodeProperty(
  value: object,
  property: "code" | "causeCode",
): string | null {
  const candidate = readUnknownProperty(value, property);
  return typeof candidate === "string" && CUTOVER_DIAGNOSTIC_CODE_SET.has(candidate)
    ? candidate
    : null;
}

function readUnknownProperty(value: object, property: string): unknown {
  try {
    return (value as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}

function assertSafeCutoverErrorCode(code: string): void {
  if (!CUTOVER_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new TypeError("cutover diagnostic code is not allowlisted");
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
