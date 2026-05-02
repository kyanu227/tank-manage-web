"use client";

import { useState, useMemo } from "react";
import { Wrench, CheckCircle2, Send, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { STATUS, ACTION } from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import MaintenanceTabs from "@/components/MaintenanceTabs";
import { useMaintenanceSwipe } from "@/features/maintenance/hooks/useMaintenanceSwipe";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";

const ACCENT = "#0ea5e9"; // Sky
const ACCENT_DARK = "#0284c7";
const ACCENT_BG = "#f0f9ff";

/**
 * 修理完了ページ
 * - 破損/不良ステータスのタンクを選択して「空」に戻す
 */
export default function RepairPage() {
  useMaintenanceSwipe("repair");
  const { tanks: allTanks, loading, refetch } = useTanks();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // 破損/不良のタンクのみを抽出
  const tanks = useMemo(
    () =>
      allTanks
        .filter((t) => t.status === STATUS.DAMAGED || t.status === STATUS.DEFECTIVE)
        .map((t) => ({
          id: t.id,
          status: t.status,
          note: t.note || "",
          selected: selectedIds.has(t.id),
        })),
    [allTanks, selectedIds]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const allSelected = tanks.length > 0 && tanks.every((t) => t.selected);
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tanks.map((t) => t.id)));
    }
  };

  const selectedCount = tanks.filter((t) => t.selected).length;

  const handleSubmit = async () => {
    const selected = tanks.filter((t) => t.selected);
    if (selected.length === 0) return;
    if (!confirm(`修理完了：${selected.length}本を処理しますか？`)) return;
    setSubmitting(true);
    try {
      const context = { actor: requireStaffIdentity() };
      await applyBulkTankOperations(
        selected.map((t) => ({
          tankId: t.id,
          transitionAction: ACTION.REPAIRED,
          currentStatus: t.status,
          context,
          location: "倉庫",
        }))
      );
      setResult({ success: true, message: `${selected.length}本の修理完了を処理しました` });
      setSelectedIds(new Set());
      refetch();
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc", position: "relative" }}>
      <MaintenanceTabs />
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: selectedCount > 0 ? 96 : 0 }}>
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "16px 16px 24px" }}>
          {/* Hero Header */}
          <div
            style={{
              position: "relative",
              marginBottom: 20,
              padding: "20px 22px",
              background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DARK} 100%)`,
              borderRadius: 20,
              color: "#fff",
              overflow: "hidden",
              boxShadow: `0 10px 30px -8px ${ACCENT}66`,
            }}
          >
            {/* decorative circle */}
            <div style={{
              position: "absolute", top: -30, right: -30, width: 120, height: 120,
              borderRadius: "50%", background: "rgba(255,255,255,0.15)",
            }} />
            <div style={{
              position: "absolute", bottom: -40, right: 40, width: 80, height: 80,
              borderRadius: "50%", background: "rgba(255,255,255,0.08)",
            }} />

            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "rgba(255,255,255,0.22)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Wrench size={24} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.01em" }}>修理完了</h1>
                <p style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>破損/不良のタンクを空ステータスに戻します</p>
              </div>
            </div>

            {/* stats strip */}
            <div style={{
              position: "relative", marginTop: 16, display: "flex", gap: 10,
            }}>
              <div style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)",
              }}>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>修理待ち</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>{tanks.length}<span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, marginLeft: 3 }}>本</span></div>
              </div>
              <div style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)",
              }}>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>選択中</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>{selectedCount}<span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, marginLeft: 3 }}>本</span></div>
              </div>
            </div>
          </div>

          {/* Select-all bar */}
          {tanks.length > 0 && (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", marginBottom: 10,
              background: "#fff", borderRadius: 12, border: "1px solid #e8eaed",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                タップして選択
              </span>
              <button
                onClick={selectAll}
                style={{
                  fontSize: 12, fontWeight: 700,
                  color: tanks.every((t) => t.selected) ? "#94a3b8" : ACCENT,
                  background: tanks.every((t) => t.selected) ? "#f1f5f9" : ACCENT_BG,
                  padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                }}
              >
                {tanks.every((t) => t.selected) ? "全解除" : "全選択"}
              </button>
            </div>
          )}

          {/* Tank grid */}
          {loading ? (
            <div style={{
              background: "#fff", borderRadius: 16, padding: "48px 20px",
              textAlign: "center", color: "#94a3b8", fontSize: 14,
              border: "1px solid #e8eaed",
            }}>
              <Loader2 size={28} style={{ animation: "spin 1s linear infinite", marginBottom: 8, opacity: 0.6 }} />
              <p>読み込み中…</p>
            </div>
          ) : tanks.length === 0 ? (
            <div style={{
              background: "#fff", borderRadius: 16, padding: "56px 20px",
              textAlign: "center", border: "1px solid #e8eaed",
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: ACCENT_BG, display: "inline-flex",
                alignItems: "center", justifyContent: "center", marginBottom: 12,
              }}>
                <Sparkles size={32} color={ACCENT} />
              </div>
              <p style={{ color: "#0f172a", fontSize: 15, fontWeight: 700 }}>すべて対応済みです</p>
              <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>修理待ちのタンクはありません</p>
            </div>
          ) : (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10,
            }}>
              {tanks.map((t) => {
                const isDamaged = t.status === STATUS.DAMAGED;
                const statusColor = isDamaged ? "#ef4444" : "#f59e0b";
                const statusBg = isDamaged ? "#fef2f2" : "#fffbeb";
                return (
                  <div
                    key={t.id}
                    onClick={() => toggleSelect(t.id)}
                    style={{
                      position: "relative",
                      padding: "14px 14px 12px",
                      borderRadius: 14,
                      cursor: "pointer",
                      background: t.selected
                        ? `linear-gradient(135deg, ${ACCENT_BG} 0%, #fff 100%)`
                        : "#fff",
                      border: `2px solid ${t.selected ? ACCENT : "#e8eaed"}`,
                      boxShadow: t.selected
                        ? `0 6px 16px -4px ${ACCENT}40`
                        : "0 1px 2px rgba(15,23,42,0.04)",
                      transform: t.selected ? "translateY(-1px)" : "none",
                      transition: "all 0.18s cubic-bezier(0.4,0,0.2,1)",
                    }}
                  >
                    {/* check mark */}
                    <div style={{
                      position: "absolute", top: 10, right: 10,
                      width: 22, height: 22, borderRadius: "50%",
                      border: `2px solid ${t.selected ? ACCENT : "#cbd5e1"}`,
                      background: t.selected ? ACCENT : "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.18s",
                    }}>
                      {t.selected && <CheckCircle2 size={14} color="#fff" strokeWidth={3} />}
                    </div>

                    {/* status pill */}
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 999,
                      background: statusBg, color: statusColor,
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.02em",
                    }}>
                      <AlertTriangle size={10} strokeWidth={3} />
                      {t.status}
                    </div>

                    {/* tank id */}
                    <div style={{
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      fontWeight: 900, fontSize: 20, color: "#0f172a",
                      marginTop: 8, letterSpacing: "0.02em",
                    }}>
                      {t.id}
                    </div>

                    {/* note */}
                    {t.note && (
                      <div style={{
                        fontSize: 11, color: "#64748b", marginTop: 4,
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {t.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {result && (
            <div style={{
              marginTop: 16,
              padding: "14px 18px", borderRadius: 14,
              background: result.success ? "#ecfdf5" : "#fef2f2",
              border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <CheckCircle2 size={20} color={result.success ? "#10b981" : "#ef4444"} />
              <span style={{ fontSize: 14, fontWeight: 600, color: result.success ? "#166534" : "#991b1b" }}>
                {result.message}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Floating submit bar */}
      {selectedCount > 0 && (
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          padding: "12px 16px max(12px, env(safe-area-inset-bottom))",
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderTop: "1px solid #e2e8f0",
          zIndex: 20,
        }}>
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
                background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DARK} 100%)`,
                color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: submitting ? 0.7 : 1,
                boxShadow: `0 8px 20px -6px ${ACCENT}80`,
                transition: "transform 0.15s",
              }}
            >
              {submitting
                ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                : <Send size={18} />}
              {submitting ? "処理中…" : `修理完了（${selectedCount}本）`}
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
