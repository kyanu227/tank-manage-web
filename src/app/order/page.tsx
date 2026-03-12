"use client";

import { useState, useRef } from "react";
import { ArrowLeft, Plus, Send, CheckCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

const TANK_TYPES = ["アルミ", "スチール 10L", "スチール 12L"] as const;
type TankType = (typeof TANK_TYPES)[number];

interface OrderItem {
  id: string;
  tankType: TankType;
  quantity: number;
}

export default function CustomerOrderPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [currentType, setCurrentType] = useState<TankType>(TANK_TYPES[0]);
  const [qty, setQty] = useState<string>("");
  const [orderQueue, setOrderQueue] = useState<OrderItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addToQueue = () => {
    const num = parseInt(qty, 10);
    if (!qty || isNaN(num) || num <= 0) return;

    setOrderQueue((prev) => {
      const idx = prev.findIndex((item) => item.tankType === currentType);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + num };
        return updated;
      }
      return [...prev, { id: Date.now().toString(), tankType: currentType, quantity: num }];
    });
    setQty("");
    inputRef.current?.blur();
  };

  const removeFromQueue = (id: string) => {
    setOrderQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const submitOrder = async () => {
    if (orderQueue.length === 0) return;
    setIsSubmitting(true);
    try {
      const sessionStr = localStorage.getItem("customerSession");
      const session = sessionStr ? JSON.parse(sessionStr) : {};
      const customerId = session.id || "unknown";
      const customerName = session.name || "不明な顧客";

      await Promise.all(
        orderQueue.map((order) =>
          addDoc(collection(db, "transactions"), {
            type: "order",
            status: "pending",
            tankType: order.tankType,
            quantity: order.quantity,
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
          発注完了
        </h2>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 40 }}>
          内容を確認して手配します。
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

  const num = parseInt(qty, 10);
  const canAdd = qty.length > 0 && !isNaN(num) && num > 0;

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
          }}
        >
          発注
        </h1>
      </header>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 20px",
          paddingBottom: orderQueue.length > 0 ? 100 : 40,
        }}
      >
        {/* Input card */}
        <div
          style={{
            background: "#fff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 24,
          }}
        >
          {/* Type selector */}
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            種類
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
              marginBottom: 20,
            }}
          >
            {TANK_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setCurrentType(type)}
                style={{
                  padding: "10px 4px",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 700,
                  border: "1.5px solid",
                  cursor: "pointer",
                  background: currentType === type ? "#0f172a" : "#fff",
                  borderColor: currentType === type ? "#0f172a" : "#e2e8f0",
                  color: currentType === type ? "#fff" : "#94a3b8",
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  lineHeight: 1.3,
                }}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Quantity */}
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            本数
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div
              onClick={() => inputRef.current?.focus()}
              style={{
                flex: 1,
                background: "#f8fafc",
                border: "1.5px solid #e2e8f0",
                borderRadius: 14,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "text",
              }}
            >
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={1}
                max={99}
                placeholder="0"
                value={qty}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || (parseInt(val, 10) <= 99 && parseInt(val, 10) >= 0)) {
                    setQty(val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addToQueue();
                }}
                style={{
                  flex: 1,
                  fontSize: 32,
                  fontWeight: 800,
                  color: qty ? "#0f172a" : "#cbd5e1",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  padding: 0,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  MozAppearance: "textfield",
                } as React.CSSProperties}
              />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#94a3b8",
                  flexShrink: 0,
                }}
              >
                本
              </span>
            </div>
            <button
              onClick={addToQueue}
              disabled={!canAdd}
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                border: "none",
                background: canAdd ? "#0f172a" : "#f1f5f9",
                color: canAdd ? "#fff" : "#cbd5e1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: canAdd ? "pointer" : "default",
                flexShrink: 0,
                transition: "background 0.12s",
              }}
            >
              <Plus size={22} />
            </button>
          </div>
          <style>{`input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}`}</style>
        </div>

        {/* Order list */}
        {orderQueue.length > 0 && (
          <div>
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#94a3b8",
                marginBottom: 10,
              }}
            >
              送信リスト（{orderQueue.length}件）
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {orderQueue.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: "#fff",
                    border: "1.5px solid #e2e8f0",
                    borderRadius: 16,
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                    {item.tankType}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: "#0f172a",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {item.quantity}
                      <span
                        style={{
                          fontSize: 12,
                          color: "#94a3b8",
                          fontWeight: 500,
                          marginLeft: 3,
                        }}
                      >
                        本
                      </span>
                    </span>
                    <button
                      onClick={() => removeFromQueue(item.id)}
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
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fixed submit bar */}
      {orderQueue.length > 0 && (
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
            onClick={submitOrder}
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
                {orderQueue.length}件を送信する
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
