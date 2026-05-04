"use client";

import { ArrowLeft, CheckCircle2, Loader2, ThumbsUp } from "lucide-react";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import type { UseReturnTagProcessingResult } from "../hooks/useReturnTagProcessing";
import type { Condition, ReturnGroup } from "../types";

interface ReturnTagProcessingScreenProps {
  selectedReturnGroup: ReturnGroup;
  returnTagProcessing: UseReturnTagProcessingResult;
}

export default function ReturnTagProcessingScreen({
  selectedReturnGroup,
  returnTagProcessing,
}: ReturnTagProcessingScreenProps) {
  const {
    returnTagSelections,
    setReturnTagSelections,
    setSelectedReturnGroup,
    returnTagProcessingSubmitting,
    processReturnTags,
  } = returnTagProcessing;

  const selectedCount = Object.values(returnTagSelections).filter((selection) => selection.selected).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc" }}>
      {/* ヘッダー */}
      <div style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button
          onClick={() => setSelectedReturnGroup(null)}
          style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>{selectedReturnGroup.customerName}</p>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>
            返却タグ処理 — {selectedCount}/{selectedReturnGroup.items.length}
          </p>
        </div>
      </div>

      {/* タンクリスト */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", paddingBottom: 100 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {selectedReturnGroup.items.map((item) => {
            const selection = returnTagSelections[item.id] || { selected: false, condition: item.condition };
            return (
              <div
                key={item.id}
                style={{ background: "#fff", border: `2px solid ${selection.selected ? "#10b981" : "#e2e8f0"}`, borderRadius: 16, padding: 16, transition: "border-color 0.15s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: "#0f172a" }}>{item.tankId}</span>
                  <button
                    onClick={() => setReturnTagSelections((p) => ({ ...p, [item.id]: { ...p[item.id], selected: !p[item.id].selected } }))}
                    style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: selection.selected ? "#10b981" : "#f1f5f9", color: selection.selected ? "#fff" : "#cbd5e1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                  >
                    <ThumbsUp size={20} />
                  </button>
                </div>
                <ReturnTagSelector<Condition>
                  value={selection.condition}
                  onChange={(condition) => setReturnTagSelections((p) => ({ ...p, [item.id]: { ...p[item.id], condition } }))}
                  options={[
                    { value: "uncharged", label: "未充填" },
                    { value: "keep", label: "持ち越し" },
                    { value: "unused", label: "未使用" },
                  ]}
                  compact
                />
              </div>
            );
          })}

          {selectedCount > 0 && (
            <button
              onClick={processReturnTags}
              disabled={returnTagProcessingSubmitting}
              style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#10b981", color: "#fff", fontSize: 16, fontWeight: 800, cursor: returnTagProcessingSubmitting ? "wait" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 8, boxShadow: "0 8px 16px rgba(16,185,129,0.25)" }}
            >
              {returnTagProcessingSubmitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
              {selectedCount}件の返却タグを処理する
            </button>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
