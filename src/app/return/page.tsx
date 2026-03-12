"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Send, CheckCircle2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

type Condition = "normal" | "unused" | "uncharged" | "keep";

interface TankItem {
  id: string;
  tankId: string;
  lentAt: Date;
  condition: Condition;
}

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: "normal", label: "通常" },
  { value: "unused", label: "未使用" },
  { value: "keep", label: "保持" },
];

// Group tanks by lending date
function groupByDate(tanks: TankItem[]): { dateLabel: string; items: TankItem[] }[] {
  const map = new Map<string, TankItem[]>();
  for (const tank of tanks) {
    const key = tank.lentAt.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tank);
  }
  return Array.from(map.entries()).map(([dateLabel, items]) => ({ dateLabel, items }));
}

export default function CustomerReturnPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [tanks, setTanks] = useState<TankItem[]>([]);
  const [loading, setLoading] = useState(true);

  // TODO: Replace with real Firebase query once GAS→Firebase sync is set up
  // Query: collection(db, "lendings").where("status", "==", "active").where("customerId", "==", currentCustomerId)
  useEffect(() => {
    // Simulate async load — real implementation queries Firestore
    const timer = setTimeout(() => {
      setLoading(false);
      // setTanks([...]) ← wire up real data here
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const updateCondition = (id: string, condition: Condition) => {
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, condition } : t)));
  };

  const removeTank = (id: string) => {
    setTanks((prev) => prev.filter((t) => t.id !== id));
  };

  const returningTanks = tanks.filter((t) => t.condition !== "keep");

  const submitReturn = async () => {
    if (returningTanks.length === 0) return;
    setIsSubmitting(true);
    try {
      const sessionStr = localStorage.getItem("customerSession");
      const session = sessionStr ? JSON.parse(sessionStr) : {};
      const customerId = session.id || "unknown";
      const customerName = session.name || "不明な顧客";

      await Promise.all(
        returningTanks.map((tank) =>
          addDoc(collection(db, "transactions"), {
            type: "return",
            status: tank.condition === "normal" ? "completed" : "pending_approval",
            tankId: tank.tankId,
            condition: tank.condition,
            customerId: customerId,
            customerName: customerName,
            createdAt: serverTimestamp(),
            source: "customer_app",
          })
        )
      );
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      alert("送信に失敗しました。再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#f8fafc",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "#f1f5f9",
            border: "1.5px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <CheckCircle2 size={38} color="#0f172a" />
        </div>
        <h2
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          返却完了
        </h2>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 40 }}>
          内容を受け付けました。
        </p>
        <button
          onClick={() => router.push("/")}
          style={{
            width: "100%",
            padding: "16px 0",
            borderRadius: 16,
            background: "#0f172a",
            border: "none",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          トップへ戻る
        </button>
      </div>
    );
  }

  const groups = groupByDate(tanks);

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#f8fafc",
        overflow: "hidden",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "44px 20px 16px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => router.push("/")}
          style={{
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
            background: "none",
            border: "none",
            cursor: "pointer",
            marginRight: 4,
          }}
        >
          <ArrowLeft size={22} />
        </button>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            flex: 1,
          }}
        >
          返却
        </h1>
        {tanks.length > 0 && (
          <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>
            {returningTanks.length} / {tanks.length}件
          </span>
        )}
      </header>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 20px",
          paddingBottom: tanks.length > 0 ? 100 : 40,
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <span
              style={{
                width: 24,
                height: 24,
                border: "2px solid #e2e8f0",
                borderTopColor: "#94a3b8",
                borderRadius: "50%",
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
              }}
            />
          </div>
        ) : tanks.length === 0 ? (
          /* Empty state */
          <div style={{ paddingTop: 20 }}>
            <div
              style={{
                background: "#fff",
                border: "1.5px solid #e2e8f0",
                borderRadius: 20,
                padding: "32px 24px",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              <p style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
                貸出中のタンクがありません
              </p>
              <p style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 500 }}>
                システムに登録されているタンクはありません
              </p>
            </div>
          </div>
        ) : (
          /* Tank list */
          <div>
            {/* Groups by date */}
            {groups.map(({ dateLabel, items }) => (
              <div key={dateLabel} style={{ marginBottom: 20 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: "#94a3b8",
                    marginBottom: 10,
                    paddingLeft: 2,
                  }}
                >
                  {dateLabel}の貸出
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((tank) => {
                    const isKeep = tank.condition === "keep";
                    return (
                      <div
                        key={tank.id}
                        style={{
                          background: "#fff",
                          border: `1.5px solid ${isKeep ? "#f1f5f9" : "#e2e8f0"}`,
                          borderRadius: 18,
                          padding: "16px 16px 14px",
                          opacity: isKeep ? 0.5 : 1,
                          transition: "opacity 0.15s",
                        }}
                      >
                        {/* Tank ID row */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 12,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 26,
                              fontWeight: 800,
                              fontFamily: "monospace",
                              letterSpacing: "0.04em",
                              color: "#0f172a",
                            }}
                          >
                            {tank.tankId}
                          </span>
                          <button
                            onClick={() => removeTank(tank.id)}
                            style={{
                              width: 28,
                              height: 28,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#cbd5e1",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            <X size={15} />
                          </button>
                        </div>

                        {/* Condition selector */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, 1fr)",
                            gap: 6,
                          }}
                        >
                          {CONDITIONS.map((cond) => (
                            <button
                              key={cond.value}
                              onClick={() => updateCondition(tank.id, cond.value)}
                              style={{
                                padding: "8px 0",
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 700,
                                border: "1.5px solid",
                                cursor: "pointer",
                                background:
                                  tank.condition === cond.value ? "#0f172a" : "#fff",
                                borderColor:
                                  tank.condition === cond.value ? "#0f172a" : "#e2e8f0",
                                color:
                                  tank.condition === cond.value ? "#fff" : "#94a3b8",
                                transition: "background 0.12s, color 0.12s",
                              }}
                            >
                              {cond.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

          </div>
        )}
      </div>

      {/* Fixed submit bar */}
      {returningTanks.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(248,250,252,0.92)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderTop: "1px solid #e2e8f0",
            padding: "12px 20px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <button
            onClick={submitReturn}
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "16px 0",
              borderRadius: 16,
              border: "none",
              background: isSubmitting ? "#475569" : "#0f172a",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              cursor: isSubmitting ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {isSubmitting ? (
              <span
                style={{
                  width: 18,
                  height: 18,
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }}
              />
            ) : (
              <>
                <Send size={17} />
                {returningTanks.length}件を返却する
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
