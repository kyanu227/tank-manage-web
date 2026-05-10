"use client";

import { ArrowRightCircle, CheckCircle2, ClipboardCheck, Link2, Loader2, Store, Truck } from "lucide-react";
import { totalOrderQuantity, type PendingOrder } from "@/lib/order-types";

interface OrderListPanelProps {
  ordersLoading: boolean;
  pendingOrders: PendingOrder[];
  approveOrder: (order: PendingOrder) => Promise<void>;
  approvingOrderId: string | null;
  openFulfillment: (order: PendingOrder) => void;
}

export default function OrderListPanel({
  ordersLoading,
  pendingOrders,
  approveOrder,
  approvingOrderId,
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
            const memoList = [order.note, order.deliveryNote]
              .filter((memo): memo is string => Boolean(memo))
              .filter((memo, index, list) => list.indexOf(memo) === index);
            const status = getOrderStatusView(order);
            const action = getOrderActionView(order);
            const isApproving = approvingOrderId === order.id;
            return (
              <div key={order.id}
                style={{
                  background: "#fff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  textAlign: "left",
                  width: "100%",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                        {order.customerName || "顧客未紐付け"}
                      </span>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: status.color,
                        background: status.background,
                        padding: "3px 7px",
                        borderRadius: 999,
                      }}>
                        {status.label}
                      </span>
                      {dateStr && <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{dateStr}</span>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 12, fontWeight: 800,
                        color: isDelivery ? "#0369a1" : "#475569",
                        background: isDelivery ? "#e0f2fe" : "#f1f5f9",
                        padding: "4px 8px", borderRadius: 6,
                      }}>
                        {isDelivery ? <Truck size={13} /> : <Store size={13} />}
                        {isDelivery ? "配達" : "引き取り"}
                      </span>
                      {isDelivery && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", background: "#f8fafc", padding: "4px 8px", borderRadius: 6 }}>
                          配達先: {order.deliveryTargetName || "未入力"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6" }}>{total}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>本</span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {order.items.map((item, index) => (
                    <div
                      key={`${item.tankType}-${index}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        padding: "7px 10px",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#334155", overflowWrap: "anywhere" }}>
                        {item.tankType || "種別未入力"}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", whiteSpace: "nowrap" }}>
                        × {item.quantity}本
                      </span>
                    </div>
                  ))}
                </div>

                {memoList.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {memoList.map((memo) => (
                    <p style={{
                      margin: 0,
                      fontSize: 12,
                      color: "#64748b",
                      fontWeight: 600,
                      overflowWrap: "anywhere",
                    }}>
                      メモ: {memo}
                    </p>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {action.kind === "approve" && (
                    <button
                      type="button"
                      onClick={() => approveOrder(order)}
                      disabled={isApproving}
                      style={{
                        flex: 1,
                        padding: "11px 12px",
                        borderRadius: 10,
                        border: "1.5px solid #2563eb",
                        background: isApproving ? "#dbeafe" : "#2563eb",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 900,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        cursor: isApproving ? "wait" : "pointer",
                      }}
                    >
                      {isApproving ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ClipboardCheck size={16} />}
                      {isApproving ? "承認中…" : "受注を承認"}
                    </button>
                  )}
                  {action.kind === "fulfill" && (
                    <button
                      type="button"
                      onClick={() => openFulfillment(order)}
                      style={{
                        flex: 1,
                        padding: "11px 12px",
                        borderRadius: 10,
                        border: "1.5px solid #10b981",
                        background: "#10b981",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 900,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        cursor: "pointer",
                      }}
                    >
                      <ArrowRightCircle size={16} />
                      タンク入力へ
                    </button>
                  )}
                  {action.kind === "disabled" && (
                    <div style={{
                      flex: 1,
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1.5px solid #e2e8f0",
                      background: "#f8fafc",
                      color: "#64748b",
                      fontSize: 13,
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}>
                      <Link2 size={16} />
                      {action.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getOrderStatusView(order: PendingOrder): {
  label: string;
  color: string;
  background: string;
} {
  if (!order.customerId || order.status === "pending_link") {
    return { label: "顧客紐付け待ち", color: "#92400e", background: "#fef3c7" };
  }
  if (order.status === "approved") {
    return { label: "承認済み", color: "#047857", background: "#d1fae5" };
  }
  if (order.status === "completed") {
    return { label: "完了済み", color: "#475569", background: "#e2e8f0" };
  }
  if (order.status === "pending_approval") {
    return { label: "承認待ち", color: "#1d4ed8", background: "#dbeafe" };
  }
  return { label: "未承認", color: "#1d4ed8", background: "#dbeafe" };
}

function getOrderActionView(order: PendingOrder):
  | { kind: "approve" }
  | { kind: "fulfill" }
  | { kind: "disabled"; label: string } {
  if (!order.customerId || order.status === "pending_link") {
    return { kind: "disabled", label: "顧客紐付け待ち" };
  }
  if (order.status === "approved") {
    return { kind: "fulfill" };
  }
  if (order.status === "pending" || order.status === "pending_approval") {
    return { kind: "approve" };
  }
  return { kind: "disabled", label: "完了済み" };
}
