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

export default function ReturnRequestList({
  pendingReturnTagsLoading,
  returnGroups,
  openReturnTagGroup,
}: ReturnRequestListProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: "#10b981", display: "inline-block" }} />
        返却タグ処理待ち
      </h3>

      {pendingReturnTagsLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
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

            return (
              <button
                key={group.customerId}
                onClick={() => openReturnTagGroup(group)}
                style={{
                  background: "#fff",
                  border: "1px solid #e8eaed",
                  borderRadius: 16,
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
                  transition: "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: "0 0 2px 0" }}>{group.customerName}</p>
                  <p style={{ fontSize: 13, color: "#64748b", margin: 0, fontWeight: 600 }}>{group.items.length}本 タグ処理待ち</p>
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

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, color: "#10b981" }}>
                    {group.items.length}
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>本</span>
                  </span>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: "#ecfdf5", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <ChevronRight size={16} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
