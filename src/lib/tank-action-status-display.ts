import {
  coerceTankActionCode,
  isFillActionCode,
  isInHouseActionCode,
  isLendActionCode,
  isReturnActionCode,
} from "./tank-action-status-codes";

export type BadgeTone = {
  color: string;
  background: string;
};

type ActionBadgeKind = "danger" | "return" | "lend" | "fill" | "inhouse" | "maintenance" | "default";

const DASHBOARD_ACTION_BADGE_TONES: Record<ActionBadgeKind, BadgeTone> = {
  danger: { color: "#b91c1c", background: "#fef2f2" },
  return: { color: "#1d4ed8", background: "#eff6ff" },
  lend: { color: "#4338ca", background: "#eef2ff" },
  fill: { color: "#047857", background: "#ecfdf5" },
  inhouse: { color: "#b45309", background: "#fffbeb" },
  maintenance: { color: "#6d28d9", background: "#f5f3ff" },
  default: { color: "#475569", background: "#f1f5f9" },
};

const PORTAL_HISTORY_ACTION_BADGE_TONES: Record<"lend" | "default", BadgeTone> = {
  lend: { color: "#6366f1", background: "#eef2ff" },
  default: { color: "#ef4444", background: "#fee2e2" },
};

export function getDashboardActionBadgeTone(action: string | null | undefined): BadgeTone {
  return DASHBOARD_ACTION_BADGE_TONES[getDashboardActionBadgeKind(action)];
}

export function getPortalHistoryActionBadgeTone(action: string | null | undefined): BadgeTone {
  const code = coerceTankActionCode(action);
  return isLendActionCode(code)
    ? PORTAL_HISTORY_ACTION_BADGE_TONES.lend
    : PORTAL_HISTORY_ACTION_BADGE_TONES.default;
}

function getDashboardActionBadgeKind(action: string | null | undefined): ActionBadgeKind {
  if (!action) return "default";

  const code = coerceTankActionCode(action);
  if (code === "damage_report" || code === "dispose") return "danger";
  if (isReturnActionCode(code)) return "return";
  if (isLendActionCode(code)) return "lend";
  if (isFillActionCode(code)) return "fill";
  if (isInHouseActionCode(code)) return "inhouse";
  if (code === "inspection" || code === "repaired") return "maintenance";

  return "default";
}
