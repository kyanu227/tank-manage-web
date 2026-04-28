"use client";

import { CheckCircle2, Loader2, Store, Truck } from "lucide-react";
import { totalOrderQuantity, type PendingOrder } from "@/lib/order-types";

interface OrderListPanelProps {
  ordersLoading: boolean;
  pendingOrders: PendingOrder[];
  openFulfillment: (order: PendingOrder) => void;
}

export default function OrderListPanel({
  ordersLoading,
  pendingOrders,
  openFulfillment,
}: OrderListPanelProps) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      {ordersLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : pendingOrders.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CheckCircle2 size={32} color="#94a3b8" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>未対応の受注はありません</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>顧客がアプリから発注するとここに表示されます</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pendingOrders.map((order) => {
            const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
            const total = totalOrderQuantity(order.items);
            const isDelivery = order.deliveryType === "delivery";
            const memo = order.note || order.deliveryNote;
            const label = order.items.length === 1
              ? order.items[0].tankType
              : `${order.items.length}種類`;
            return (
              <button key={order.id} onClick={() => openFulfillment(order)}
                style={{
                  background: "#fff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  textAlign: "left",
                  width: "100%",
                  cursor: "pointer",
                }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{order.customerName}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{dateStr}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#475569", background: "#f1f5f9", padding: "4px 8px", borderRadius: 6 }}>{label}</span>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 12, fontWeight: 800,
                      color: isDelivery ? "#0369a1" : "#475569",
                      background: isDelivery ? "#e0f2fe" : "#f1f5f9",
                      padding: "4px 8px", borderRadius: 6,
                    }}>
                      {isDelivery ? <Truck size={13} /> : <Store size={13} />}
                      {isDelivery ? `配達: ${order.deliveryTargetName || "配達先未入力"}` : "引き取り"}
                    </span>
                  </div>
                  {memo && (
                    <p style={{
                      margin: "8px 0 0",
                      fontSize: 12,
                      color: "#64748b",
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 360,
                    }}>
                      メモ: {memo}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6" }}>{total}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>本</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
