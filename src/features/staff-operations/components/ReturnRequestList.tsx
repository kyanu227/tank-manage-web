"use client";

import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import { getOperationMessage } from "@/lib/operation-messages";
import { getReturnTagLabelOrNull } from "@/lib/return-tag-labels";
import { formatStaffCount, formatStaffShortDateTime, formatStaffTankCount } from "@/lib/staff-display";
import { getStaffOperationText } from "../i18n";
import type { Condition, ReturnGroup } from "../types";

interface ReturnRequestListProps {
  pendingReturnTagsLoading: boolean;
  returnGroups: ReturnGroup[];
  openReturnTagGroup: (group: ReturnGroup) => void;
  locale?: Locale;
  loadFailed?: boolean;
  retry?: () => void | Promise<void>;
}

const CONDITION_STYLE: Record<Condition, { color: string; background: string }> = {
  normal: { color: "#2563eb", background: "#eff6ff" },
  unused: { color: "#059669", background: "#ecfdf5" },
  uncharged: { color: "#dc2626", background: "#fef2f2" },
  keep: { color: "#d97706", background: "#fffbeb" },
};
const UNKNOWN_CONDITION_STYLE = { color: "#475569", background: "#f1f5f9" } as const;

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  return null;
}

function formatRequestedAt(value: number | null, locale: "ja" | "en"): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (locale === "ja") {
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return formatStaffShortDateTime(date, locale);
}

export default function ReturnRequestList({
  pendingReturnTagsLoading,
  returnGroups,
  openReturnTagGroup,
  locale,
  loadFailed = false,
  retry,
}: ReturnRequestListProps) {
  const sessionLocale = useStaffLocale();
  const staffLocale = locale ?? sessionLocale;
  const totalTankCount = returnGroups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: "#10b981", display: "inline-block" }} />
          {getStaffOperationText("pendingReturnTags", staffLocale)}
        </h3>
        <span style={{ fontSize: 11, color: totalTankCount > 0 ? "#059669" : "#94a3b8", fontWeight: 900, border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 8px", background: "#fff" }}>
          {getStaffOperationText("returnGroupSummary", staffLocale, {
            customerCountLabel: formatStaffCount(returnGroups.length, staffLocale, {
              ja: "顧客", enSingular: "customer", enPlural: "customers",
            }),
            tankCountLabel: formatStaffTankCount(totalTankCount, staffLocale),
          })}
        </span>
      </div>

      {pendingReturnTagsLoading ? (
        <div role="status" aria-label={getStaffOperationText("loadingReturnRequests", staffLocale)} style={{ display: "flex", justifyContent: "center", padding: 40, background: "#fff", border: "1px solid #e8eaed", borderRadius: 16 }}>
          <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : loadFailed ? (
        <div role="alert" style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c", margin: "0 0 12px" }}>
            {getStaffOperationText("returnRequestsLoadFailure", staffLocale)}
          </p>
          {retry && (
            <button type="button" onClick={() => void retry()} style={{ border: "none", borderRadius: 10, padding: "8px 14px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              {getStaffOperationText("retry", staffLocale)}
            </button>
          )}
        </div>
      ) : returnGroups.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#94a3b8" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>
            {getOperationMessage("returnProcessing.empty", staffLocale)}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {returnGroups.map((group) => {
            const previewItems = group.items.slice(0, 3);
            const hiddenCount = Math.max(0, group.items.length - previewItems.length);
            const latestRequestedAt = Math.max(
              ...group.items
                .map((item) => toMillis(item.createdAt))
                .filter((value): value is number => value !== null),
              0,
            );
            const requestedAtLabel = formatRequestedAt(latestRequestedAt || null, staffLocale);

            return (
              <button
                type="button"
                aria-label={getStaffOperationText("selectReturnGroup", staffLocale, {
                  customerName: group.customerName,
                })}
                key={group.customerId}
                onClick={() => openReturnTagGroup(group)}
                style={{
                  background: "#fff",
                  border: "1px solid #e8eaed",
                  borderRadius: 16,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
                  overflow: "hidden",
                  transition: "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
                }}
              >
                <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                    <div style={{ padding: 4, background: "#dcfce7", borderRadius: 8, color: "#059669", flexShrink: 0, marginTop: 1 }}>
                      <ChevronRight size={18} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>{group.customerName}</h3>
                        <span style={{ padding: "2px 7px", borderRadius: 999, background: "#ecfdf5", color: "#059669", fontSize: 10, fontWeight: 900 }}>
                          {formatStaffTankCount(group.items.length, staffLocale)}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0", fontWeight: 600 }}>
                        {getOperationMessage(
                          requestedAtLabel
                            ? "returnProcessing.pendingTagWithLatestHelper"
                            : "returnProcessing.pendingTagHelper",
                          staffLocale,
                          requestedAtLabel ? { requestedAt: requestedAtLabel } : undefined,
                        )}
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                        {previewItems.map((item) => {
                          const label = getReturnTagLabelOrNull(item.condition, staffLocale);
                          const style = label
                            ? CONDITION_STYLE[item.condition] ?? UNKNOWN_CONDITION_STYLE
                            : UNKNOWN_CONDITION_STYLE;
                          return (
                            <span
                              key={item.id}
                              style={{
                                padding: "3px 6px",
                                borderRadius: 999,
                                background: style.background,
                                color: style.color,
                                fontSize: 10,
                                fontWeight: 900,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.tankId} {label ?? getStaffOperationText("unknownReturnTag", staffLocale, {
                                value: String(item.condition ?? ""),
                              })}
                            </span>
                          );
                        })}
                        {hiddenCount > 0 && (
                          <span style={{ padding: "3px 6px", borderRadius: 999, background: "#f1f5f9", color: "#64748b", fontSize: 10, fontWeight: 900 }}>
                            {getStaffOperationText("hiddenItems", staffLocale, {
                              count: hiddenCount,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: "#059669", background: "#ecfdf5", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>
                      {getStaffOperationText("review", staffLocale)}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {getStaffOperationText("tap", staffLocale)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
