"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import type { ReturnGroup } from "../types";

interface ReturnRequestListProps {
  pendingReturnTagsLoading: boolean;
  returnGroups: ReturnGroup[];
  openReturnTagGroup: (group: ReturnGroup) => void;
}

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
          {returnGroups.map((group) => (
            <button
              key={group.customerId}
              onClick={() => openReturnTagGroup(group)}
              style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left", width: "100%" }}
            >
              <div>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: "0 0 2px 0" }}>{group.customerName}</p>
                <p style={{ fontSize: 13, color: "#64748b", margin: 0, fontWeight: 600 }}>{group.items.length}本 タグ処理待ち</p>
              </div>
              <span style={{ fontSize: 24, fontWeight: 900, color: "#10b981" }}>
                {group.items.length}
                <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>本</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
