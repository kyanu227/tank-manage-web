export const STAFF_OPERATION_ERROR_CODES = [
  "reason_too_short",
  "tank_not_found",
  "invalid_tank_id",
  "operation_not_allowed",
  "tank_disposed",
  "customer_required",
  "customer_mismatch",
  "selection_required",
  "duplicate_tank",
  "recovery_confirmation_required",
  "recovery_cancelled",
  "recovery_browser_required",
  "recovery_previous_customer_missing",
  "target_log_not_found",
  "log_already_replaced",
  "latest_log_required",
  "log_not_active",
  "tank_log_required",
  "recovery_log_not_editable",
  "correction_window_expired",
  "stale_tank_cycle",
  "staff_session_invalid",
] as const;

export type StaffOperationErrorCode =
  (typeof STAFF_OPERATION_ERROR_CODES)[number];

export type StaffOperationErrorParams = Readonly<
  Record<string, string | number>
>;

export type StaffOperationErrorOptions = Readonly<{
  params?: StaffOperationErrorParams;
  message?: string;
  cause?: unknown;
}>;

export type StaffOperationErrorLike = Readonly<{
  staffOperationErrorBrand: "StaffOperationError";
  code: StaffOperationErrorCode;
  params?: unknown;
  message?: unknown;
  cause?: unknown;
}>;

const STAFF_OPERATION_ERROR_BRAND = "StaffOperationError" as const;
const STAFF_OPERATION_ERROR_CODE_SET = new Set<string>(
  STAFF_OPERATION_ERROR_CODES,
);

/** domain が code + params を投げるための locale 非依存 error。 */
export class StaffOperationError extends Error {
  readonly staffOperationErrorBrand = STAFF_OPERATION_ERROR_BRAND;
  readonly code: StaffOperationErrorCode;
  readonly params: StaffOperationErrorParams;
  override readonly cause?: unknown;

  constructor(
    code: StaffOperationErrorCode,
    options: StaffOperationErrorOptions = {},
  ) {
    const params = Object.freeze({ ...(options.params ?? {}) });
    super(options.message ?? "");
    this.name = "StaffOperationError";
    this.code = code;
    this.params = params;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function isStaffOperationError(
  error: unknown,
): error is StaffOperationErrorLike {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<StaffOperationErrorLike>;
  return candidate.staffOperationErrorBrand === STAFF_OPERATION_ERROR_BRAND
    && isStaffOperationErrorCode(candidate.code);
}

export function isStaffOperationErrorCode(
  code: unknown,
): code is StaffOperationErrorCode {
  return typeof code === "string" && STAFF_OPERATION_ERROR_CODE_SET.has(code);
}
