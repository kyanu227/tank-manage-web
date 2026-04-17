"use client";

import { useState, useRef } from "react";
import { ArrowLeft, Send, CheckCircle2, X, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

const TANK_TYPES = [
  { key: "スチール 10L", label: "スチール", sub: "10L", color: "#6366f1", bg: "#eef2ff" },
  { key: "スチール 12L", label: "スチール", sub: "12L", color: "#0ea5e9", bg: "#e0f2fe" },
  { key: "アルミ",       label: "アルミ",   sub: "",    color: "#10b981", bg: "#d1fae5" },
];

interface CartItem {
  uid: string;
  tankType: string;
  quantity: number;
}

export default function CustomerOrderPage() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<string>(TANK_TYPES[0].key);
  const [input, setInput] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentQty = parseInt(input, 10) || 0;
  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);

  const addToCart = () => {
    if (currentQty <= 0) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.tankType === selectedType);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + currentQty };
        return updated;
      }
      return [...prev, { uid: `${Date.now()}`, tankType: selectedType, quantity: currentQty }];
    });
    setInput("");
  };

  const removeFromCart = (uid: string) => {
    setCart((prev) => prev.filter((c) => c.uid !== uid));
  };

  const submitOrder = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);
    try {
      const sessionStr = localStorage.getItem("customerSession");
      const session = sessionStr ? JSON.parse(sessionStr) : {};
      const customerId = session.uid || "unknown";
      const customerName = session.name || "不明な顧客";

      // 1発注 = 1ドキュメント（items配列）としてまとめて保存する
      const ref = await addDoc(collection(db, "transactions"), {
        type: "order",
        status: "pending",
        items: cart.map((item) => ({
          tankType: item.tankType,
          quantity: item.quantity,
        })),
        customerId,
        customerName,
        createdAt: serverTimestamp(),
        source: "customer_portal",
      });
      setOrderIds([ref.id]);
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      alert("送信に失敗しました。再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ─── 完了画面 ─── */
  if (isSuccess) {
    return (
      <div style={{
        minHeight: "100dvh", background: "#f8fafc",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "0 24px", textAlign: "center",
      }}>
        <div style={{
          width: 88, height: 88, borderRadius: "50%",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 28, boxShadow: "0 12px 32px rgba(99,102,241,0.3)",
        }}>
          <CheckCircle2 size={44} color="#fff" />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 8 }}>
          発注完了
        </h2>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>担当者が確認次第、手配します。</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 36 }}>
          {orderIds.map((id) => (
            <span key={id} style={{ fontSize: 11, fontFamily: "monospace", color: "#94a3b8", background: "#f1f5f9", padding: "3px 8px", borderRadius: 6 }}>
              #{id.slice(-6).toUpperCase()}
            </span>
          ))}
        </div>
        <button onClick={() => router.push("/portal")} style={{
          width: "100%", maxWidth: 360, padding: "16px 0", borderRadius: 18,
          background: "#0f172a", border: "none", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
        }}>
          トップへ戻る
        </button>
      </div>
    );
  }

  const typeInfo = TANK_TYPES.find((t) => t.key === selectedType)!;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#f8fafc", overflow: "hidden" }}>

      {/* Header — compact */}
      <header style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 14px 8px", flexShrink: 0 }}>
        <button onClick={() => router.push("/portal")} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", flex: 1 }}>発注</span>
        {totalItems > 0 && (
          <div style={{ background: "#6366f1", color: "#fff", padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
            {totalItems}本
          </div>
        )}
      </header>

      {/* Type selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "0 12px", flexShrink: 0 }}>
        {TANK_TYPES.map(({ key, label, sub, color, bg }) => {
          const active = selectedType === key;
          return (
            <button
              key={key}
              onClick={() => { setSelectedType(key); setInput(""); inputRef.current?.focus(); }}
              style={{
                padding: "10px 4px", borderRadius: 12, border: `2px solid ${active ? color : "#e8eaed"}`,
                background: active ? bg : "#fff",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                cursor: "pointer", transition: "all 0.12s",
                boxShadow: active ? `0 3px 10px ${color}22` : "none",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: active ? color : "#64748b" }}>{label}</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: active ? color : "#94a3b8", letterSpacing: "-0.02em" }}>{sub || "AL"}</span>
            </button>
          );
        })}
      </div>

      {/* Cart — compact list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 4px", minHeight: 0 }}>
        {cart.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}>
            種類を選んで本数を入力してください
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {cart.map((item) => {
              const t = TANK_TYPES.find((t) => t.key === item.tankType)!;
              return (
                <div key={item.uid} style={{
                  background: "#fff", borderLeft: `3px solid ${t.color}`,
                  borderRadius: 10, padding: "8px 12px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  border: `1px solid ${t.color}20`, borderLeftWidth: 3,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{item.tankType}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: t.color }}>
                      {item.quantity}<span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginLeft: 2 }}>本</span>
                    </span>
                    <button onClick={() => removeFromCart(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", cursor: "pointer", padding: 2 }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input row */}
      <div style={{ padding: "8px 12px", flexShrink: 0, background: "#fff", borderTop: "1px solid #e8eaed" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            onClick={() => inputRef.current?.focus()}
            style={{
              flex: 1, background: "#f8fafc",
              border: `2px solid ${input ? typeInfo.color : "#e8eaed"}`,
              borderRadius: 12, padding: "10px 14px",
              display: "flex", alignItems: "baseline", gap: 6,
              cursor: "text", transition: "border-color 0.15s",
            }}
          >
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1} max={999}
              placeholder="0"
              value={input}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                setInput(v === "0" ? "" : v);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") addToCart(); }}
              style={{
                flex: 1, fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em",
                color: input ? typeInfo.color : "#cbd5e1",
                background: "transparent", border: "none", outline: "none",
                padding: 0, lineHeight: 1, width: 0,
                MozAppearance: "textfield",
              } as React.CSSProperties}
            />
            <span style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>本</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginLeft: "auto" }}>{typeInfo.label} {typeInfo.sub}</span>
          </div>
          <button
            onClick={addToCart}
            disabled={currentQty <= 0}
            style={{
              width: 48, height: 48, borderRadius: 14, border: "none", flexShrink: 0,
              background: currentQty > 0 ? typeInfo.color : "#e2e8f0",
              color: currentQty > 0 ? "#fff" : "#94a3b8",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: currentQty > 0 ? "pointer" : "default",
              boxShadow: currentQty > 0 ? `0 4px 12px ${typeInfo.color}40` : "none",
              transition: "all 0.15s",
            }}
          >
            <Plus size={22} />
          </button>
        </div>
        <style>{`input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}`}</style>
      </div>

      {/* Submit bar */}
      <div style={{
        padding: "10px 16px",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
        background: "#fff", borderTop: "1px solid #e8eaed", flexShrink: 0,
      }}>
        <button
          onClick={submitOrder}
          disabled={isSubmitting || cart.length === 0}
          style={{
            width: "100%", padding: "16px 0", borderRadius: 18, border: "none",
            background: cart.length > 0 ? "#0f172a" : "#e2e8f0",
            color: cart.length > 0 ? "#fff" : "#94a3b8",
            fontSize: 16, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            cursor: cart.length > 0 && !isSubmitting ? "pointer" : "default",
            transition: "all 0.15s",
          }}
        >
          {isSubmitting ? (
            <span style={{ width: 18, height: 18, border: "2.5px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
          ) : (
            <>
              <Send size={17} />
              {cart.length > 0 ? `${totalItems}本 (${cart.length}種) を発注する` : "種類と本数を選んでください"}
            </>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
