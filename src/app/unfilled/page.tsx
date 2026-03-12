"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Send, CheckCircle2, Delete, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

interface TankItem {
  id: string;
  tankId: string;
}

// Temporary simulated query for lent tanks.
// Replace with: collection(db, "lendings").where("status", "==", "active")
const simulatedLentTanks = ["A-01", "A-02", "B-10", "C-05", "D-99", "E-10", "F-22", "X-01"];

export default function UnfilledReportPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [tanks, setTanks] = useState<TankItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Available prefixes derived from currently lent tanks
  const [availablePrefixes, setAvailablePrefixes] = useState<string[]>([]);
  const [selectedPrefix, setSelectedPrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");

  const [lentTanks, setLentTanks] = useState<string[]>([]);

  useEffect(() => {
    // Simulate fetching lent tanks from Firebase
    const timer = setTimeout(() => {
      setLentTanks(simulatedLentTanks);
      
      const prefixes = new Set<string>();
      simulatedLentTanks.forEach(id => {
        const match = id.match(/^[A-Za-z]/);
        if (match) prefixes.add(match[0].toUpperCase());
      });
      setAvailablePrefixes(Array.from(prefixes).sort());
      
      setLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const handlePrefixClick = (prefix: string) => {
    setSelectedPrefix(prefix);
    setInputValue("");
  };

  const handleNativeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > 2) return;
    
    setInputValue(val);

    if (val.length === 2) {
      // Auto-submit logic when 2 digits are entered
      const newTankId = `${selectedPrefix}-${val}`;
      
      // Validation: must be in lent tanks
      if (!lentTanks.includes(newTankId)) {
        alert(`${newTankId}は現在貸出中ではありません。`);
        setInputValue("");
        return;
      }

      if (tanks.some(t => t.tankId === newTankId)) {
        alert("すでに追加されています。");
        setInputValue("");
        return;
      }

      setTanks(prev => [...prev, { id: Date.now().toString(), tankId: newTankId }]);
      // Reset input for next tank
      setInputValue("");
      setSelectedPrefix(null);
    }
  };

  const removeTank = (id: string) => {
    setTanks((prev) => prev.filter((t) => t.id !== id));
  };

  const submitReport = async () => {
    if (tanks.length === 0) return;
    setIsSubmitting(true);
    try {
      await Promise.all(
        tanks.map((tank) =>
          addDoc(collection(db, "transactions"), {
            type: "uncharged_report",
            status: "completed",
            tankId: tank.tankId,
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
          報告完了
        </h2>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 40 }}>
          ご報告ありがとうございます。内容を受け付けました。
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
          未充填タンク報告
        </h1>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 20px",
          paddingBottom: tanks.length > 0 ? 100 : 40,
        }}
      >
        <div style={{ marginBottom: 24, textAlign: "center" }}>
           <p style={{ color: "#ef4444", fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
             ご不便をおかけして申し訳ありません。
           </p>
           <p style={{ color: "#64748b", fontSize: 13, fontWeight: 500 }}>
             お届けしたタンクが未充填だった場合、こちらからご報告ください。<br/>
             <span style={{ fontSize: 11, color: "#94a3b8" }}>※現在お客様に貸出中のタンクのみ報告可能です</span>
           </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
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
        ) : availablePrefixes.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 20 }}>
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
                報告できる未充填タンクはありません
              </p>
            </div>
          </div>
        ) : (
          <div style={{
            background: "#fff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 20,
          }}>
            {/* 1. Prefix Selection */}
            <div style={{ marginBottom: !!selectedPrefix ? 24 : 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>1. アルファベットを選択</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {availablePrefixes.map(prefix => (
                  <button
                    key={prefix}
                    onClick={() => handlePrefixClick(prefix)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      fontSize: 18,
                      fontWeight: 800,
                      fontFamily: "monospace",
                      border: "1.5px solid",
                      borderColor: selectedPrefix === prefix ? "#0f172a" : "#e2e8f0",
                      background: selectedPrefix === prefix ? "#0f172a" : "#f8fafc",
                      color: selectedPrefix === prefix ? "#fff" : "#475569",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {prefix}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Keypad (shows only after prefix selected) */}
            {selectedPrefix && (
              <div style={{
                animation: "fadeIn 0.2s ease",
              }}>
                <style>{`
                  @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
                `}</style>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>2. 数字を2桁入力</p>
                
                {/* Native Input */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{
                    background: "#f1f5f9",
                    borderRadius: 14,
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 60,
                    fontSize: 24,
                    fontWeight: 800,
                    fontFamily: "monospace",
                    color: "#0f172a",
                    flexShrink: 0,
                  }}>
                    {selectedPrefix} -
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="00"
                    value={inputValue}
                    onChange={handleNativeInput}
                    autoFocus
                    autoComplete="off"
                    style={{
                      flex: 1,
                      background: "#fff",
                      border: "1.5px solid #0f172a",
                      borderRadius: 14,
                      padding: "16px 20px",
                      fontSize: 28,
                      fontWeight: 800,
                      fontFamily: "monospace",
                      letterSpacing: "0.2em",
                      color: "#0f172a",
                      outline: "none",
                      height: 60,
                      textAlign: "center",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selected List */}
        {tanks.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 10, paddingLeft: 2 }}>
              報告リスト ({tanks.length}件)
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tanks.map((tank) => (
                <div
                  key={tank.id}
                  style={{
                    background: "#fef2f2",
                    border: "1.5px solid #fecaca",
                    borderRadius: 16,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      fontFamily: "monospace",
                      letterSpacing: "0.04em",
                      color: "#991b1b",
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
                      color: "#f87171",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {tanks.length > 0 && (
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
            onClick={submitReport}
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "16px 0",
              borderRadius: 16,
              border: "none",
              background: isSubmitting ? "#fca5a5" : "#ef4444",
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
                報告を送信する
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
