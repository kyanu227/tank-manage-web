"use client";

import { useState, useEffect } from "react";
import { ShoppingCart, Plus, Send, Loader2, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import ProcurementTabs from "@/components/ProcurementTabs";
import { useProcurementSwipe } from "@/features/procurement/hooks/useProcurementSwipe";
import { submitSupplyOrder } from "@/lib/firebase/supply-order";

interface OrderMasterItem { colA: string; colB: string; price: number; category: string; }
interface CartItem { uid: string; name: string; count: number; price: number; }

export default function SupplyOrderPage() {
  useProcurementSwipe("supply-order");
  const [master, setMaster] = useState<OrderMasterItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "orderMaster"));
        const items: OrderMasterItem[] = [];
        snap.forEach((d) => items.push(d.data() as OrderMasterItem));
        setMaster(items);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const addToCart = (item: OrderMasterItem) => {
    const name = item.category === "tank" ? `${item.colA} ${item.colB}` : item.colB;
    const existing = cart.find((c) => c.name === name);
    if (existing) {
      setCart((prev) => prev.map((c) => c.name === name ? { ...c, count: c.count + 1 } : c));
    } else {
      setCart((prev) => [...prev, { uid: `${Date.now()}`, name, count: 1, price: Number(item.price) || 0 }]);
    }
  };

  const updateCount = (uid: string, count: number) => {
    if (count <= 0) { setCart((prev) => prev.filter((c) => c.uid !== uid)); return; }
    setCart((prev) => prev.map((c) => c.uid === uid ? { ...c, count } : c));
  };

  const total = cart.reduce((sum, c) => sum + c.price * c.count, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    if (!confirm(`${cart.length}品目を発注しますか？`)) return;
    setSubmitting(true);
    try {
      await submitSupplyOrder({
        items: cart.map((c) => ({
          name: c.name,
          count: c.count,
          price: c.price,
        })),
        staff: "スタッフ",
      });
      setResult({ success: true, message: `${cart.length}品目の発注を完了（合計 ¥${total.toLocaleString()}）` });
      setCart([]);
    } catch (e: unknown) {
      setResult({ success: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const tanks = master.filter((m) => m.category === "tank");
  const supplies = master.filter((m) => m.category === "supply");

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden" }}>
      <ProcurementTabs activeHref="/staff/supply-order" />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "16px 20px", background: "#fffbeb", borderRadius: 16, border: "1.5px solid #fde68a" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingCart size={22} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>備品・資材発注</h1>
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>マスタから備品・資材を選んで発注</p>
            </div>
          </div>

          {loading ? (
            <p style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 }}>読み込み中…</p>
          ) : master.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 30, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
              発注マスタが未登録です。管理画面から登録してください。
            </div>
          ) : (
            <>
              {/* Tank items */}
              {tanks.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 10 }}>🔵 タンク</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {tanks.map((t, i) => (
                      <div key={i} onClick={() => addToCart(t)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e8eaed", cursor: "pointer" }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{t.colA} {t.colB}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, color: "#64748b", fontFamily: "monospace" }}>¥{Number(t.price).toLocaleString()}</span>
                          <Plus size={16} color="#6366f1" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Supply items */}
              {supplies.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#10b981", marginBottom: 10 }}>🟢 備品</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {supplies.map((s, i) => (
                      <div key={i} onClick={() => addToCart(s)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e8eaed", cursor: "pointer" }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{s.colB}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, color: "#64748b", fontFamily: "monospace" }}>¥{Number(s.price).toLocaleString()}</span>
                          <Plus size={16} color="#10b981" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Cart */}
          {cart.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>カート ({cart.length}品目)</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {cart.map((c) => (
                  <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #f1f5f9" }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", flex: 1 }}>{c.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button onClick={() => updateCount(c.uid, c.count - 1)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, minWidth: 24, textAlign: "center" as const }}>{c.count}</span>
                      <button onClick={() => updateCount(c.uid, c.count + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    </div>
                    <span style={{ fontSize: 13, fontFamily: "monospace", color: "#64748b", minWidth: 60, textAlign: "right" as const }}>¥{(c.price * c.count).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #e8eaed", marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>合計</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>¥{total.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 24px", width: "100%", boxSizing: "border-box" }}>
          {cart.length > 0 && (
            <button onClick={handleSubmit} disabled={submitting}
              style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "#f59e0b", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: submitting ? 0.7 : 1, marginBottom: 16 }}>
              {submitting ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={18} />}
              {submitting ? "発注中…" : `発注を確定（¥${total.toLocaleString()}）`}
            </button>
          )}

          {result && (
            <div style={{ padding: "16px 20px", borderRadius: 14, background: result.success ? "#ecfdf5" : "#fef2f2", border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}`, display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle2 size={20} color={result.success ? "#10b981" : "#ef4444"} />
              <span style={{ fontSize: 14, fontWeight: 600, color: result.success ? "#166534" : "#991b1b" }}>{result.message}</span>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
