"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { isNewDocId } from "@/lib/firebase/diff-write";
import {
  listOrderItems,
  saveOrderItems,
  type OrderMasterItem,
} from "@/lib/firebase/order-master-settings";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b", transition: "border-color 0.15s",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 20px", borderRadius: 10, border: "none",
  background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700,
  cursor: "pointer", transition: "all 0.15s",
};

const btnOutline: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8,
  border: "1px solid #e2e8f0", background: "#fff",
  color: "#64748b", fontSize: 13, fontWeight: 600,
  cursor: "pointer", transition: "all 0.15s",
};

export default function OrderMasterPage() {
  const { can } = useAdminCapabilities();
  const canManage = can("orderMaster.manage");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderList, setOrderList] = useState<OrderMasterItem[]>([]);
  const [dirtyOrderIds, setDirtyOrderIds] = useState<string[]>([]);
  const [deletedOrderIds, setDeletedOrderIds] = useState<string[]>([]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const orders = await listOrderItems();
      setOrderList(orders.length > 0 ? orders : []);
      setDirtyOrderIds([]);
      setDeletedOrderIds([]);
    } catch (e) {
      console.error("Fetch order master error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const addOrder = (category: "tank" | "supply") => {
    if (!canManage) return;
    setOrderList((prev) => [
      ...prev,
      { id: `new_${Date.now()}`, category, colA: "", colB: "", price: 0 },
    ]);
  };

  const updateOrder = (
    id: string,
    field: keyof Pick<OrderMasterItem, "colA" | "colB" | "price">,
    value: string | number,
  ) => {
    if (!canManage) return;
    setDirtyOrderIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    setOrderList((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const removeOrder = (id: string) => {
    if (!canManage) return;
    if (!isNewDocId(id)) {
      setDeletedOrderIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    }
    setDirtyOrderIds((prev) => prev.filter((dirtyId) => dirtyId !== id));
    setOrderList((prev) => prev.filter((o) => o.id !== id));
  };

  const saveOrder = async () => {
    if (!canManage) return;
    if (!confirm("発注品目マスタを保存しますか？")) return;
    setSaving(true);
    try {
      await saveOrderItems({
        items: orderList,
        dirty: dirtyOrderIds,
        deleted: deletedOrderIds,
      });
      await fetchOrders();
      alert("発注品目マスタを保存しました。");
    } catch (e: unknown) {
      alert("保存エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
        <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>データを読み込み中…</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      {!canManage && (
        <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 10, background: "#f8fafc", color: "#64748b", fontSize: 12 }}>
          閲覧権限で表示しています。発注品目の変更は管理権限を持つ利用者だけが行えます。
        </div>
      )}
      <div
        style={{
          background: "#f8f9fb", border: "1px solid #e8eaed",
          borderRadius: 10, padding: "12px 16px", marginBottom: 16,
          fontSize: 12, color: "#64748b", lineHeight: 1.6,
        }}
      >
        <strong>💡 ヒント:</strong> タンク → 種類(A列) ＋ 容量(B列)。 備品 → 表示順(A列) ＋ 品名(B列)。
      </div>

      {/* Tank section */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#6366f1", display: "flex", alignItems: "center", gap: 6 }}>
            <Package size={14} /> タンク
          </span>
          {canManage && <button onClick={() => addOrder("tank")} style={btnOutline}>
            <Plus size={14} /> タンク追加
          </button>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                {["種類", "容量", "単価", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderList.filter((o) => o.category === "tank").length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#cbd5e1", fontSize: 13 }}>
                    タンクが未登録です
                  </td>
                </tr>
              ) : (
                orderList.filter((o) => o.category === "tank").map((o) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 12px" }}>
                      <input disabled={!canManage} style={{ ...inputStyle, textAlign: "center" as const }} value={o.colA} placeholder="種類" onChange={(e) => updateOrder(o.id, "colA", e.target.value)} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <input disabled={!canManage} style={{ ...inputStyle, fontWeight: 700 }} value={o.colB} placeholder="容量" onChange={(e) => updateOrder(o.id, "colB", e.target.value)} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <input disabled={!canManage} type="number" style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace" }} value={o.price} onChange={(e) => updateOrder(o.id, "price", e.target.value)} />
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      {canManage && <button onClick={() => removeOrder(o.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                        <Trash2 size={16} />
                      </button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Supply section */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: 6 }}>
            <Package size={14} /> 備品
          </span>
          {canManage && <button onClick={() => addOrder("supply")} style={btnOutline}>
            <Plus size={14} /> 備品追加
          </button>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                {["表示順", "品名", "単価", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderList.filter((o) => o.category === "supply").length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#cbd5e1", fontSize: 13 }}>
                    備品が未登録です
                  </td>
                </tr>
              ) : (
                orderList.filter((o) => o.category === "supply").map((o) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 12px" }}>
                      <input disabled={!canManage} type="number" style={{ ...inputStyle, textAlign: "center" as const }} value={o.colA} placeholder="順" onChange={(e) => updateOrder(o.id, "colA", e.target.value)} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <input disabled={!canManage} style={{ ...inputStyle, fontWeight: 700 }} value={o.colB} placeholder="品名" onChange={(e) => updateOrder(o.id, "colB", e.target.value)} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <input disabled={!canManage} type="number" style={{ ...inputStyle, textAlign: "right" as const, fontFamily: "monospace" }} value={o.price} onChange={(e) => updateOrder(o.id, "price", e.target.value)} />
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      {canManage && <button onClick={() => removeOrder(o.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                        <Trash2 size={16} />
                      </button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && <button onClick={saveOrder} disabled={saving} style={btnPrimary}>
        <Save size={16} />
        {saving ? "保存中…" : "発注品目マスタを保存"}
      </button>}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
