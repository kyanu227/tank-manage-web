"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import type { ReturnGroup } from "../types";

interface ReturnRequestListProps {
  approvalsLoading: boolean;
  returnGroups: ReturnGroup[];
  openReturnGroup: (group: ReturnGroup) => void;
}

export default function ReturnRequestList({
  approvalsLoading,
  returnGroups,
  openReturnGroup,
}: ReturnRequestListProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: "#10b981", display: "inline-block" }} />
        返却リクエスト
      </h3>

      {approvalsLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : returnGroups.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#94a3b8" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>未確認の返却リクエストはありません</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {returnGroups.map((group) => (
            <button
              key={group.customerId}
              onClick={() => openReturnGroup(group)}
              style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left", width: "100%" }}
            >
              <div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>{group.customerName}</p>
                <p style={{ fontSize: 12, color: "#94a3b8" }}>{group.items.length}本 返却待ち</p>
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
