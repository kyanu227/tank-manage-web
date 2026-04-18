"use client";

import { useState, useMemo } from "react";
import { ShieldCheck, CheckCircle2, Send, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { STATUS, ACTION } from "@/lib/tank-rules";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import MaintenanceTabs from "@/components/MaintenanceTabs";
import { getStaffName } from "@/hooks/useStaffSession";
import { useTanks } from "@/hooks/useTanks";
import { useInspectionSettings } from "@/hooks/useInspectionSettings";

const ACCENT = "#8b5cf6"; // Violet
const ACCENT_DARK = "#7c3aed";
const ACCENT_BG = "#f5f3ff";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Firestore Timestamp | Date | 文字列 などから Date を取り出す。取れなければ null。 */
function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v?.toMillis === "function") return new Date(v.toMillis());
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    // 旧GAS互換の "YYYY/MM/DD" と ISO文字列の両方を受ける
    const d = new Date(v.replace(/-/g, "/"));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Date を "YYYY/MM/DD" 形式に整形（Firestore 保存用） */
function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/**
 * 耐圧検査完了ページ
 * - 次回検査期限が告知閾値以内に迫ったタンクを抽出
 * - 選択して検査完了処理（ステータス空化 + nextMaintenanceDate を N年後に更新）
 */
export default function InspectionPage() {
  const { tanks: allTanks, loading: tanksLoading, refetch } = useTanks();
  const { settings, loading: settingsLoading } = useInspectionSettings();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const loading = tanksLoading || settingsLoading;

  // 期限切れ / 期限間近のタンク抽出（status=破棄 は除外、nextMaintenanceDate 未設定も除外）
  const tanks = useMemo(() => {
    const now = new Date();
    const limit = new Date();
    limit.setMonth(limit.getMonth() + settings.alertMonths);

    return allTanks
      .filter((t) => t.status !== STATUS.DISPOSED)
      .map((t) => ({ tank: t, nextDate: toDate(t.nextMaintenanceDate) }))
      .filter(({ nextDate }) => nextDate && nextDate.getTime() <= limit.getTime())
      .map(({ tank, nextDate }) => {
        const daysLeft = Math.floor((nextDate!.getTime() - now.getTime()) / MS_PER_DAY);
        return {
          id: tank.id,
          status: tank.status,
          note: tank.note || "",
          nextDate: nextDate!,
          daysLeft,
          selected: selectedIds.has(tank.id),
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [allTanks, settings.alertMonths, selectedIds]);

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
    if (!confirm(`耐圧検査完了：${selected.length}本を処理しますか？\n次回期限は ${settings.validityYears}年後 に更新されます。`)) return;
    setSubmitting(true);
    try {
      const staffName = getStaffName();
      // 次回期限 = 今日 + validityYears年。旧GAS互換で "YYYY/MM/DD" 文字列として保存
      const next = new Date();
      next.setFullYear(next.getFullYear() + settings.validityYears);
      const todayStr = formatDateYMD(new Date());
      const nextStr = formatDateYMD(next);

      await applyBulkTankOperations(
        selected.map((t) => ({
          tankId: t.id,
          transitionAction: ACTION.INSPECTION,
          currentStatus: t.status,
          staff: staffName,
          location: "倉庫",
          tankExtra: {
            maintenanceDate: todayStr,
            nextMaintenanceDate: nextStr,
          },
        }))
      );
      setResult({ success: true, message: `${selected.length}本の耐圧検査完了を処理しました` });
      setSelectedIds(new Set());
      refetch();
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  /** daysLeft を日本語ラベル化。マイナスは「●期限切」、0以上は「あとNヶ月」 */
  const formatDaysLeft = (daysLeft: number) => {
    if (daysLeft < 0) return "●期限切";
    if (daysLeft < 30) return "あと今月中";
    return `あと${Math.floor(daysLeft / 30)}ヶ月`;
  };

  const expiredCount = tanks.filter((t) => t.daysLeft < 0).length;

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
                <ShieldCheck size={24} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.01em" }}>耐圧検査完了</h1>
                <p style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                  期限 {settings.alertMonths}ヶ月前〜期限切れのタンクが対象です
                </p>
              </div>
            </div>

            <div style={{
              position: "relative", marginTop: 16, display: "flex", gap: 10,
            }}>
              <div style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)",
              }}>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>対象</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>
                  {tanks.length}
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, marginLeft: 3 }}>本</span>
                </div>
              </div>
              <div style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)",
              }}>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>うち期限切</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>
                  {expiredCount}
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, marginLeft: 3 }}>本</span>
                </div>
              </div>
              <div style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)",
              }}>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>選択中</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>
                  {selectedCount}
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, marginLeft: 3 }}>本</span>
                </div>
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
              <p style={{ color: "#0f172a", fontSize: 15, fontWeight: 700 }}>対象タンクはありません</p>
              <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                期限が迫ったタンクが出たらここに表示されます
              </p>
            </div>
          ) : (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10,
            }}>
              {tanks.map((t) => {
                const isExpired = t.daysLeft < 0;
                const statusColor = isExpired ? "#ef4444" : "#f59e0b";
                const statusBg = isExpired ? "#fef2f2" : "#fffbeb";
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

                    {/* 期限ラベル */}
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 999,
                      background: statusBg, color: statusColor,
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.02em",
                    }}>
                      {isExpired && <AlertTriangle size={10} strokeWidth={3} />}
                      {formatDaysLeft(t.daysLeft)}
                    </div>

                    {/* tank id */}
                    <div style={{
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      fontWeight: 900, fontSize: 20, color: "#0f172a",
                      marginTop: 8, letterSpacing: "0.02em",
                    }}>
                      {t.id}
                    </div>

                    {/* 次回期限日 */}
                    <div style={{
                      fontSize: 11, color: "#64748b", marginTop: 2,
                    }}>
                      期限: {t.nextDate.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })}
                    </div>

                    {/* note */}
                    {t.note && (
                      <div style={{
                        fontSize: 11, color: "#64748b", marginTop: 2,
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
              {submitting ? "処理中…" : `耐圧検査完了（${selectedCount}本）`}
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
