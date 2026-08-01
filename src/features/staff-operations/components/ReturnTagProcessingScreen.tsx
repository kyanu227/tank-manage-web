"use client";

import { ArrowLeft, CheckCircle2, Loader2, ThumbsUp } from "lucide-react";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { getReturnTagLabel, getReturnTagLabelOrNull } from "@/lib/return-tag-labels";
import { formatStaffCount } from "@/lib/staff-display";
import { getStaffOperationText } from "../i18n";
import type { UseReturnTagProcessingResult } from "../hooks/useReturnTagProcessing";
import type { Condition, ReturnGroup } from "../types";

interface ReturnTagProcessingScreenProps {
  selectedReturnGroup: ReturnGroup;
  returnTagProcessing: UseReturnTagProcessingResult;
  locale?: Locale;
}

export default function ReturnTagProcessingScreen({
  selectedReturnGroup,
  returnTagProcessing,
  locale = DEFAULT_LOCALE,
}: ReturnTagProcessingScreenProps) {
  const {
    returnTagSelections,
    setReturnTagSelections,
    setSelectedReturnGroup,
    returnConfirmationSubmitting,
    confirmSelectedReturnRequests,
  } = returnTagProcessing;

  const selectedCount = Object.values(returnTagSelections).filter((selection) => selection.selected).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc" }}>
      {/* ヘッダー */}
      <div style={{ padding: "14px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button
          type="button"
          aria-label={getStaffOperationText("back", locale)}
          onClick={() => setSelectedReturnGroup(null)}
          style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>{selectedReturnGroup.customerName}</p>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>
            {getStaffOperationText("returnTagProcessing", locale)} — {selectedCount}/{selectedReturnGroup.items.length}
          </p>
        </div>
      </div>

      {/* タンクリスト */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", paddingBottom: 100 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {selectedReturnGroup.items.map((item) => {
            const selection = returnTagSelections[item.id] || { selected: false, condition: item.condition };
            const conditionLabel = getReturnTagLabelOrNull(selection.condition, locale);
            return (
              <div
                key={item.id}
                style={{ background: "#fff", border: `2px solid ${selection.selected ? "#10b981" : "#e2e8f0"}`, borderRadius: 16, padding: 16, transition: "border-color 0.15s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: "#0f172a" }}>{item.tankId}</span>
                  <button
                    type="button"
                    aria-label={getStaffOperationText(
                      selection.selected ? "deselectTank" : "selectTank",
                      locale,
                      { tankId: item.tankId },
                    )}
                    aria-pressed={selection.selected}
                    onClick={() => setReturnTagSelections((p) => ({ ...p, [item.id]: { ...p[item.id], selected: !p[item.id].selected } }))}
                    style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: selection.selected ? "#10b981" : "#f1f5f9", color: selection.selected ? "#fff" : "#cbd5e1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                  >
                    <ThumbsUp size={20} />
                  </button>
                </div>
                {!conditionLabel && (
                  <p role="alert" style={{ margin: "0 0 10px", padding: "6px 8px", borderRadius: 8, background: "#f1f5f9", color: "#475569", fontSize: 11, fontWeight: 800 }}>
                    {getStaffOperationText("unknownReturnTag", locale, {
                      value: String(selection.condition ?? ""),
                    })}
                  </p>
                )}
                <ReturnTagSelector<Condition>
                  value={selection.condition}
                  onChange={(condition) => setReturnTagSelections((p) => ({ ...p, [item.id]: { ...p[item.id], condition } }))}
                  options={[
                    { value: "uncharged", label: getReturnTagLabel("uncharged", locale) },
                    { value: "keep", label: getReturnTagLabel("keep", locale) },
                    { value: "unused", label: getReturnTagLabel("unused", locale) },
                  ]}
                  locale={locale}
                  compact
                />
              </div>
            );
          })}

          {selectedCount > 0 && (
            <button
              type="button"
              aria-busy={returnConfirmationSubmitting}
              onClick={confirmSelectedReturnRequests}
              disabled={returnConfirmationSubmitting}
              style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#10b981", color: "#fff", fontSize: 16, fontWeight: 800, cursor: returnConfirmationSubmitting ? "wait" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 8, boxShadow: "0 8px 16px rgba(16,185,129,0.25)" }}
            >
              {returnConfirmationSubmitting ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={18} />}
              {getStaffOperationText("processReturnTags", locale, {
                countLabel: formatStaffCount(selectedCount, locale, {
                  ja: "件", enSingular: "return tag", enPlural: "return tags",
                }),
              })}
            </button>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
