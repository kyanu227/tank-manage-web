"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Send, CheckCircle2, Clock, RotateCcw, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { doc, getDoc } from "firebase/firestore";
import ReturnTagSelector, { getReturnTagLabel, getReturnTagStyle, type ReturnTagValue } from "@/components/ReturnTagSelector";
import { createPortalReturnRequests } from "@/lib/firebase/portal-transaction-service";
import { tanksRepository } from "@/lib/firebase/repositories";
import { getPortalIdentityFromStorage, isLinkedPortalIdentity, type PortalIdentity } from "@/lib/portal";
import { STATUS } from "@/lib/tank-rules";

type Condition = ReturnTagValue;

interface TankItem {
  id: string;          // Firestore doc id (= tankId)
  lentAt: Date | null;
  condition: Condition;
}

function fmtDate(d: Date | null): string {
  if (!d) return "日付不明";
  return `${d.getMonth() + 1}/${d.getDate()} 貸出`;
}

export default function CustomerReturnPage() {
  const router = useRouter();
  const [tanks, setTanks] = useState<TankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [scheduleTime, setScheduleTime] = useState<string | null>(null); // "HH:MM"
  const [autoTriggered, setAutoTriggered] = useState(false);
  const [identity, setIdentity] = useState<PortalIdentity | null>(null);

  // Fetch rented tanks + schedule
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const currentIdentity = getPortalIdentityFromStorage();
      setIdentity(currentIdentity);
      if (!isLinkedPortalIdentity(currentIdentity)) {
        setTanks([]);
        setScheduleTime(null);
        return;
      }

      const [tankDocs, settingsDoc] = await Promise.all([
        tanksRepository.getTanks({ location: currentIdentity.customerName, status: STATUS.LENT }),
        getDoc(doc(db, "settings", "portal")),
      ]);

      const items: TankItem[] = tankDocs.map((t) => {
        const lentAt = (t.updatedAt as any)?.toDate?.() ?? null;
        return { id: t.id, lentAt, condition: "normal" };
      });
      // Sort by lent date ascending (oldest first)
      items.sort((a, b) => (a.lentAt?.getTime() ?? 0) - (b.lentAt?.getTime() ?? 0));
      setTanks(items);

      // Schedule
      if (settingsDoc.exists()) {
        const s = settingsDoc.data();
        if (s.autoReturnHour != null && s.autoReturnMinute != null) {
          const h = String(s.autoReturnHour).padStart(2, "0");
          const m = String(s.autoReturnMinute).padStart(2, "0");
          setScheduleTime(`${h}:${m}`);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-return check
  useEffect(() => {
    if (!scheduleTime || loading || tanks.length === 0) return;
    if (!isLinkedPortalIdentity(identity)) return;
    const [h, m] = scheduleTime.split(":").map(Number);
    const now = new Date();
    const todayKey = `autoReturn_${identity.customerId}_${now.toDateString()}`;
    const alreadyDone = localStorage.getItem(todayKey) === "1";
    if (alreadyDone) return;

    const scheduled = new Date(now);
    scheduled.setHours(h, m, 0, 0);

    if (now >= scheduled) {
      setAutoTriggered(true);
      // Submit after short delay to let UI settle
      setTimeout(() => submitReturn(true, todayKey), 1200);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleTime, loading, identity]);

  const setCondition = (id: string, cond: Condition) => {
    setTanks((prev) => prev.map((t) => t.id === id ? { ...t, condition: cond } : t));
  };

  const submitReturn = async (auto = false, autoKey?: string) => {
    const submitItems = tanks;
    if (submitItems.length === 0) {
      if (!auto) alert("送信するタンクがありません");
      return;
    }
    if (!isLinkedPortalIdentity(identity)) {
      if (!auto) alert("返却申請は顧客紐付け後に利用できます。");
      return;
    }
    setIsSubmitting(true);
    try {
      await createPortalReturnRequests({
        identity,
        items: submitItems.map((tank) => ({
          tankId: tank.id,
          condition: tank.condition,
        })),
        source: auto ? "auto_schedule" : "customer_portal",
      });
      if (autoKey) localStorage.setItem(autoKey, "1");
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      alert("送信に失敗しました。再度お試しください。");
      setIsSubmitting(false);
      setAutoTriggered(false);
    }
  };

  const returningCount = tanks.filter((t) => t.condition !== "keep").length;
  const keepCount = tanks.filter((t) => t.condition === "keep").length;
  const submitCount = tanks.length;
  const isLinked = isLinkedPortalIdentity(identity);

  if (isSuccess) {
    return (
      <div style={{
        minHeight: "100dvh", background: "#f8fafc",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "0 24px", textAlign: "center",
      }}>
        <div style={{
          width: 88, height: 88, borderRadius: "50%",
          background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 28, boxShadow: "0 12px 32px rgba(14,165,233,0.3)",
        }}>
          <CheckCircle2 size={44} color="#fff" />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 8 }}>
          返却申請完了
        </h2>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 36 }}>
          {autoTriggered ? "自動返却を実行しました。" : "担当者が確認後、承認します。"}
        </p>
        <button
          onClick={() => router.push("/portal")}
          style={{
            width: "100%", maxWidth: 360, padding: "16px 0", borderRadius: 18,
            background: "#0f172a", border: "none", color: "#fff",
            fontSize: 16, fontWeight: 700, cursor: "pointer",
          }}
        >
          トップへ戻る
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "48px 20px 16px" }}>
        <button
          onClick={() => router.push("/portal")}
          style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", background: "none", border: "none", cursor: "pointer" }}
        >
          <ArrowLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.03em", margin: 0 }}>
            返却
          </h1>
          {scheduleTime && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
              <Clock size={11} color="#94a3b8" />
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                自動返却: 毎日 {scheduleTime}
              </span>
            </div>
          )}
        </div>
        {submitCount > 0 && !loading && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#0ea5e9", color: "#fff",
            padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
          }}>
            <RotateCcw size={13} />
            {submitCount}本
          </div>
        )}
      </header>

      {/* Auto-trigger banner */}
      {autoTriggered && !isSuccess && (
        <div style={{
          margin: "0 20px 12px",
          background: "#fef3c7", border: "1.5px solid #f59e0b",
          borderRadius: 14, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <AlertCircle size={16} color="#f59e0b" />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>
            自動返却を実行しています…
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, padding: "0 20px 120px", display: "flex", flexDirection: "column", gap: 12 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
            <span style={{
              width: 24, height: 24, border: "2.5px solid #e2e8f0", borderTopColor: "#94a3b8",
              borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite",
            }} />
          </div>
        ) : !isLinked ? (
          <div style={{
            background: "#fff", border: "1.5px solid #e8eaed", borderRadius: 20,
            padding: "40px 24px", textAlign: "center",
          }}>
            <AlertCircle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>
              返却は顧客確認後に利用できます
            </p>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>
              会社情報の確認後、貸出中タンクの返却申請が可能になります。
            </p>
          </div>
        ) : tanks.length === 0 ? (
          <div style={{
            background: "#fff", border: "1.5px solid #e8eaed", borderRadius: 20,
            padding: "40px 24px", textAlign: "center",
          }}>
            <CheckCircle2 size={32} color="#cbd5e1" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", margin: 0 }}>
              貸出中のタンクがありません
            </p>
          </div>
        ) : (
          tanks.map((tank) => {
            const isKeep = tank.condition === "keep";
            const conditionStyle = getReturnTagStyle(tank.condition);
            const isSpecial = tank.condition !== "normal";
            return (
              <div
                key={tank.id}
                style={{
                  background: "#fff",
                  border: `2px solid ${isSpecial ? conditionStyle.border : "#e8eaed"}`,
                  borderRadius: 20, padding: "18px 18px 14px",
                  opacity: isKeep ? 0.65 : 1,
                  transition: "all 0.15s",
                  boxShadow: isKeep ? "none" : isSpecial ? `0 2px 10px ${conditionStyle.color}18` : "0 2px 8px rgba(0,0,0,0.04)",
                }}
              >
                {/* Tank ID + date */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <span style={{
                      fontSize: 28, fontWeight: 900, fontFamily: "monospace",
                      letterSpacing: "0.04em", color: isKeep ? "#94a3b8" : "#0f172a",
                    }}>
                      {tank.id}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                      <Clock size={11} color="#cbd5e1" />
                      <span style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>
                        {fmtDate(tank.lentAt)}
                      </span>
                    </div>
                  </div>
                  {isSpecial && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "4px 10px", borderRadius: 8,
                      background: conditionStyle.background, color: conditionStyle.color, letterSpacing: "0.05em",
                    }}>
                      {getReturnTagLabel(tank.condition)}
                    </span>
                  )}
                </div>

                {/* Condition selector */}
                <ReturnTagSelector<Condition>
                  value={tank.condition}
                  onChange={(value) => setCondition(tank.id, value)}
                  options={[
                    { value: "uncharged", label: "未充填" },
                    { value: "keep", label: "持ち越し" },
                    { value: "unused", label: "未使用" },
                  ]}
                  enableSwipe
                  swipeRightValue="unused"
                  swipeLeftValue="keep"
                />
              </div>
            );
          })
        )}
      </div>

      {/* Fixed submit bar */}
      {!loading && isLinked && tanks.length > 0 && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "rgba(248,250,252,0.95)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid #e8eaed",
          padding: "14px 20px",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
        }}>
          {keepCount > 0 && (
            <div style={{ textAlign: "center", fontSize: 11, color: "#f59e0b", fontWeight: 600, marginBottom: 8 }}>
              持ち越し {keepCount}本 を記録します
            </div>
          )}
          <button
            onClick={() => submitReturn(false)}
            disabled={isSubmitting || submitCount === 0}
            style={{
              width: "100%", padding: "16px 0", borderRadius: 18, border: "none",
              background: submitCount > 0 ? "#0f172a" : "#e2e8f0",
              color: submitCount > 0 ? "#fff" : "#94a3b8",
              fontSize: 16, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              cursor: submitCount > 0 && !isSubmitting ? "pointer" : "default",
              transition: "all 0.15s",
            }}
          >
            {isSubmitting ? (
              <span style={{
                width: 18, height: 18, border: "2.5px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff", borderRadius: "50%",
                display: "inline-block", animation: "spin 0.7s linear infinite",
              }} />
            ) : (
              <>
                <Send size={17} />
                {returningCount === 0 && keepCount > 0
                  ? `${keepCount}本を持ち越し記録する`
                  : keepCount > 0
                    ? `${returningCount}本を返却 / ${keepCount}本を持ち越し`
                    : `${returningCount}本を返却申請する`}
              </>
            )}
          </button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
