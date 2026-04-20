"use client";

import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Send, CheckCircle2, Loader2, X } from "lucide-react";
import { ACTION } from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import TankIdInput from "@/components/TankIdInput";
import MaintenanceTabs from "@/components/MaintenanceTabs";
import { getStaffName } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";

const ACCENT = "#ef4444";

export default function DamageReportPage() {
  const { prefixes } = useTanks();
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [numberValue, setNumberValue] = useState("");
  const [queue, setQueue] = useState<{ uid: string; tankId: string }[]>([]);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ページ全体スクロールロック（ドラムロール用）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.style.overflow = "";
    };
  }, []);

  const handleCommit = (tankId: string) => {
    if (queue.some((q) => q.tankId === tankId)) return;
    setQueue((prev) => [{ uid: `${Date.now()}_${Math.random()}`, tankId }, ...prev]);
    setLastAdded(tankId);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setLastAdded(null), 1500);
  };

  const removeFromQueue = (uid: string) => {
    setQueue((prev) => prev.filter((q) => q.uid !== uid));
  };

  const handleSubmit = async () => {
    if (queue.length === 0) return;
    if (!confirm(`${queue.length}本の破損報告を送信しますか？`)) return;
    setSubmitting(true);
    try {
      const staffName = getStaffName();
      await applyBulkTankOperations(
        queue.map((item) => ({
          tankId: item.tankId,
          transitionAction: ACTION.DAMAGE_REPORT,
          staff: staffName,
          location: "倉庫",
          logNote: note,
        }))
      );
      setResult({ success: true, message: `${queue.length}本の破損報告を完了しました` });
      setQueue([]);
      setNote("");
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden" }}>
      <MaintenanceTabs />
      <TankIdInput
        prefixes={prefixes}
        activePrefix={activePrefix}
        onPrefixChange={setActivePrefix}
        numberValue={numberValue}
        onNumberChange={setNumberValue}
        onCommit={handleCommit}
        accentColor={ACCENT}
        lastAdded={lastAdded}
        headerSlot={
          <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#fef2f2", borderRadius: 12, border: "1px solid #fecaca" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AlertTriangle size={14} color="#fff" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h1 style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", margin: 0 }}>破損報告</h1>
                <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>ステータスを「破損」に変更</p>
              </div>
            </div>
          </div>
        }
        beforeConfirm={
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>送信リスト</span>
              {queue.length > 0 && (
                <span style={{ background: ACCENT, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                  {queue.length}
                </span>
              )}
            </div>
            {queue.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 20px", color: "#cbd5e1", marginTop: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>右のドラムからアルファベットを選び、</p>
                <p style={{ margin: "4px 0", fontSize: 13, fontWeight: 600 }}>数字2桁を入力してください</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {queue.map((item) => (
                  <div key={item.uid} style={{
                    background: "#fff", padding: "10px 14px", borderRadius: 12,
                    borderLeft: `5px solid ${ACCENT}`,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <span style={{ fontSize: 17, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                      {item.tankId}
                    </span>
                    <button onClick={() => removeFromQueue(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 6, cursor: "pointer", marginRight: -6 }}>
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
        footerSlot={
          <div style={{
            padding: "8px 16px max(8px, env(safe-area-inset-bottom, 8px))",
            background: "#fff", borderTop: "1px solid #e2e8f0", flexShrink: 0,
            display: "flex", flexDirection: "column", gap: 8, zIndex: 20,
          }}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="破損内容（例: バルブ不良、タンク凹み等）"
              rows={2}
              style={{
                width: "100%", boxSizing: "border-box",
                border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 12px",
                // iOS Safari は font-size < 16px の入力欄でフォーカス時に画面を自動拡大するため 16px を保つ
                fontSize: 16, resize: "none", outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || queue.length === 0}
              style={{
                width: "100%", padding: "12px", borderRadius: 12, border: "none",
                background: queue.length > 0 ? ACCENT : "#e2e8f0",
                color: queue.length > 0 ? "#fff" : "#94a3b8",
                fontSize: 15, fontWeight: 900,
                display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                cursor: submitting || queue.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
              <span>{queue.length}件の破損報告</span>
            </button>
            {result && (
              <div style={{
                padding: "6px 10px", borderRadius: 8,
                background: result.success ? "#ecfdf5" : "#fef2f2",
                border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}`,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <CheckCircle2 size={14} color={result.success ? "#10b981" : "#ef4444"} />
                <span style={{ fontSize: 12, fontWeight: 600, color: result.success ? "#166534" : "#991b1b" }}>
                  {result.message}
                </span>
              </div>
            )}
          </div>
        }
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
