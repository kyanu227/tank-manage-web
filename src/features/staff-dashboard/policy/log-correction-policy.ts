import { timestampToMillis } from "@/features/staff-dashboard/timestamp";
import { CORRECTION_LIMIT_MS } from "@/lib/tank-operation-limits";

export const LOG_CORRECTION_BLOCK_REASONS = [
  "not_tank_log",
  "inactive_log",
  "missing_created_at",
  "edit_expired",
  "transition_plan_missing",
  "recovery_correction_blocked",
  "review_correction_blocked",
] as const;

export type LogCorrectionBlockReason =
  (typeof LOG_CORRECTION_BLOCK_REASONS)[number];

export type LogCorrectionPolicyEntry = Readonly<{
  logKind?: unknown;
  logStatus?: unknown;
  revisionCreatedAt?: unknown;
  transitionPlan?: Readonly<{ kind?: unknown }> | null;
  transitionReviewStatus?: unknown;
}>;

export function canModifyLog(
  log: LogCorrectionPolicyEntry,
  nowMs: number,
): boolean {
  return canModifyLogReason(log, nowMs) == null;
}

export function canModifyLogReason(
  log: LogCorrectionPolicyEntry,
  nowMs: number,
): LogCorrectionBlockReason | null {
  if (log.logKind !== "tank") return "not_tank_log";
  if (log.logStatus && log.logStatus !== "active") return "inactive_log";

  const createdAt = timestampToMillis(log.revisionCreatedAt);
  if (createdAt == null || !Number.isFinite(createdAt)) {
    return "missing_created_at";
  }
  if (nowMs - createdAt > CORRECTION_LIMIT_MS) return "edit_expired";
  return null;
}

export function canCorrectLogReason(
  log: LogCorrectionPolicyEntry,
  nowMs: number,
): LogCorrectionBlockReason | null {
  const baseReason = canModifyLogReason(log, nowMs);
  if (baseReason) return baseReason;
  if (!log.transitionPlan?.kind) return "transition_plan_missing";
  if (log.transitionPlan.kind === "recovery") {
    return "recovery_correction_blocked";
  }
  if (
    log.transitionReviewStatus
    && log.transitionReviewStatus !== "not_required"
  ) {
    return "review_correction_blocked";
  }
  return null;
}
