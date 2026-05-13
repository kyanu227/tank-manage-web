"use client";

import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import type { Condition, ReturnGroup } from "../types";

interface ReturnRequestListProps {
  pendingReturnTagsLoading: boolean;
  returnGroups: ReturnGroup[];
  openReturnTagGroup: (group: ReturnGroup) => void;
}

const CONDITION_STYLE: Record<Condition, { label: string; color: string; background: string }> = {
  normal: { label: "通常", color: "#2563eb", background: "#eff6ff" },
  unused: { label: "未使用", color: "#059669", background: "#ecfdf5" },
  uncharged: { label: "未充填", color: "#dc2626", background: "#fef2f2" },
  keep: { label: "持ち越し", color: "#d97706", background: "#fffbeb" },
};

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

function formatRequestedAt(value: number | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function ReturnRequestList({
  pendingReturnTagsLoading,
  returnGroups,
  openReturnTagGroup,
}: ReturnRequestListProps) {
  const totalTankCount = returnGroups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: "#10b981", display: "inline-block" }} />
          返却タグ処理待ち
        </h3>
        <span style={{ fontSize: 11, color: totalTankCount > 0 ? "#059669" : "#94a3b8", fontWeight: 900, border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 8px", background: "#fff" }}>
          {returnGroups.length}顧客 / {totalTankCount}本
        </span>
      </div>

      {pendingReturnTagsLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40, background: "#fff", border: "1px solid #e8eaed", borderRadius: 16 }}>
          <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : returnGroups.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#94a3b8" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>処理待ちの返却タグはありません</p>
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
            const requestedAtLabel = formatRequestedAt(latestRequestedAt || null);

            return (
              <button
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
                          {group.items.length}本
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0", fontWeight: 600 }}>
                        タグ処理待ち{requestedAtLabel ? ` / 最新 ${requestedAtLabel}` : ""}
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                        {previewItems.map((item) => {
                          const style = CONDITION_STYLE[item.condition] ?? CONDITION_STYLE.normal;
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
                              {item.tankId} {style.label}
                            </span>
                          );
                        })}
                        {hiddenCount > 0 && (
                          <span style={{ padding: "3px 6px", borderRadius: 999, background: "#f1f5f9", color: "#64748b", fontSize: 10, fontWeight: 900 }}>
                            +{hiddenCount}件
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: "#059669", background: "#ecfdf5", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>
                      確認
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", whiteSpace: "nowrap" }}>
                      タップ
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
