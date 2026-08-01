"use client";

import { useState, useEffect } from "react";
import { ShoppingCart, Plus, Send, Loader2, CheckCircle2 } from "lucide-react";
import ProcurementTabs from "@/components/ProcurementTabs";
import { useProcurementSwipe } from "@/features/procurement/hooks/useProcurementSwipe";
import {
  formatPlaceOrder,
  formatProcurementJpy,
  formatProcurementItemCount,
  formatQuantityButtonLabel,
  formatSupplyOrderConfirm,
  formatSupplyOrderSuccess,
  getProcurementText,
} from "@/features/procurement/i18n";
import { submitSupplyOrder } from "@/lib/firebase/supply-order";
import { requireStaffIdentity, useStaffLocale } from "@/hooks/useStaffSession";
import { listOrderItems, type OrderMasterItem } from "@/lib/firebase/order-master-settings";
import {
  getStaffOperationErrorMessage,
  logStaffOperationError,
} from "@/lib/staff-operation-error";

interface CartItem { uid: string; name: string; count: number; price: number; }

export default function SupplyOrderPage() {
  useProcurementSwipe("supply-order");
  const staffLocale = useStaffLocale();
  const [master, setMaster] = useState<OrderMasterItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        setMaster(await listOrderItems());
      } catch (e) {
        console.error("listOrderItems failed", e);
        setLoadFailed(true);
      }
      finally { setLoading(false); }
    })();
  }, [loadVersion]);

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
    if (!confirm(formatSupplyOrderConfirm(cart.length, staffLocale))) return;
    setSubmitting(true);
    try {
      await submitSupplyOrder({
        items: cart.map((c) => ({
          name: c.name,
          count: c.count,
          price: c.price,
        })),
        actor: requireStaffIdentity(),
      });
      setResult({ success: true, message: formatSupplyOrderSuccess(cart.length, total, staffLocale) });
      setCart([]);
    } catch (e: unknown) {
      logStaffOperationError("submitSupplyOrder failed", e);
      setResult({
        success: false,
        message: getStaffOperationErrorMessage(e, staffLocale),
      });
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
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
                {getProcurementText("supplyOrderTitle", staffLocale)}
              </h1>
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {getProcurementText("supplyOrderDescription", staffLocale)}
              </p>
            </div>
          </div>

          {loading ? (
            <p role="status" aria-live="polite" style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 }}>
              {getProcurementText("loading", staffLocale)}
            </p>
          ) : loadFailed ? (
            <div role="alert" style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 16, padding: 30, textAlign: "center", color: "#991b1b", fontSize: 14 }}>
              <p>{getProcurementText("orderItemsLoadFailure", staffLocale)}</p>
              <button type="button" onClick={() => setLoadVersion((value) => value + 1)}>
                {getProcurementText("retry", staffLocale)}
              </button>
            </div>
          ) : master.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 30, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
              {getProcurementText("orderMasterEmpty", staffLocale)}
            </div>
          ) : (
            <>
              {/* Tank items */}
              {tanks.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 10 }}>
                    🔵 {getProcurementText("tanks", staffLocale)}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {tanks.map((t, i) => (
                      <button type="button" key={i} onClick={() => addToCart(t)}
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e8eaed", cursor: "pointer", textAlign: "left", font: "inherit" }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{t.colA} {t.colB}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, color: "#64748b", fontFamily: "monospace" }}>{formatProcurementJpy(Number(t.price), staffLocale)}</span>
                          <Plus size={16} color="#6366f1" aria-hidden="true" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Supply items */}
              {supplies.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#10b981", marginBottom: 10 }}>
                    🟢 {getProcurementText("supplies", staffLocale)}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {supplies.map((s, i) => (
                      <button type="button" key={i} onClick={() => addToCart(s)}
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e8eaed", cursor: "pointer", textAlign: "left", font: "inherit" }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{s.colB}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, color: "#64748b", fontFamily: "monospace" }}>{formatProcurementJpy(Number(s.price), staffLocale)}</span>
                          <Plus size={16} color="#10b981" aria-hidden="true" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Cart */}
          {cart.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>
                {getProcurementText("cart", staffLocale)} ({formatProcurementItemCount(cart.length, staffLocale)})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {cart.map((c) => (
                  <div key={c.uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #f1f5f9" }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{c.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button type="button" aria-label={formatQuantityButtonLabel("decrease", c.name, staffLocale)} onClick={() => updateCount(c.uid, c.count - 1)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, minWidth: 24, textAlign: "center" as const }}>{c.count}</span>
                      <button type="button" aria-label={formatQuantityButtonLabel("increase", c.name, staffLocale)} onClick={() => updateCount(c.uid, c.count + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    </div>
                    <span style={{ fontSize: 13, fontFamily: "monospace", color: "#64748b", minWidth: 60, textAlign: "right" as const }}>{formatProcurementJpy(c.price * c.count, staffLocale)}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #e8eaed", marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>{getProcurementText("total", staffLocale)}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>{formatProcurementJpy(total, staffLocale)}</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 24px", width: "100%", boxSizing: "border-box" }}>
          {cart.length > 0 && (
            <button type="button" onClick={handleSubmit} disabled={submitting} aria-busy={submitting}
              style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "#f59e0b", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: submitting ? 0.7 : 1, marginBottom: 16 }}>
              {submitting ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={18} />}
              {submitting ? getProcurementText("placingOrder", staffLocale) : formatPlaceOrder(total, staffLocale)}
            </button>
          )}

          {result && (
            <div role={result.success ? "status" : "alert"} aria-live="polite" style={{ padding: "16px 20px", borderRadius: 14, background: result.success ? "#ecfdf5" : "#fef2f2", border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}`, display: "flex", alignItems: "center", gap: 10 }}>
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
