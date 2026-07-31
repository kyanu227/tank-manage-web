"use client";

import { ArrowRightCircle, CheckCircle2, ClipboardCheck, Link2, Loader2, Store, Truck } from "lucide-react";
import { totalOrderQuantity, type PendingOrder } from "@/lib/order-types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { formatStaffShortDateTime, formatStaffTankCount, getStaffTankUnit } from "@/lib/staff-display";
import { getStaffOperationText } from "../i18n";

interface OrderListPanelProps {
  ordersLoading: boolean;
  pendingOrders: PendingOrder[];
  approveOrder: (order: PendingOrder) => Promise<void>;
  approvingOrderId: string | null;
  openFulfillment: (order: PendingOrder) => void;
  locale?: Locale;
  ordersLoadFailed?: boolean;
  retryOrders?: () => void | Promise<void>;
}

export default function OrderListPanel({
  ordersLoading,
  pendingOrders,
  approveOrder,
  approvingOrderId,
  openFulfillment,
  locale = DEFAULT_LOCALE,
  ordersLoadFailed = false,
  retryOrders,
}: OrderListPanelProps) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      {ordersLoading ? (
        <div role="status" aria-label={getStaffOperationText("loadingOrders", locale)} style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Loader2 size={24} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : ordersLoadFailed ? (
        <div role="alert" style={{ background: "#fff", border: "1.5px solid #fecaca", borderRadius: 20, padding: "32px 20px", textAlign: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: "#b91c1c", margin: "0 0 12px" }}>
            {getStaffOperationText("ordersLoadFailure", locale)}
          </p>
          {retryOrders && (
            <button type="button" onClick={() => void retryOrders()} style={{ border: "none", borderRadius: 10, padding: "9px 16px", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              {getStaffOperationText("retry", locale)}
            </button>
          )}
        </div>
      ) : pendingOrders.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CheckCircle2 size={32} color="#94a3b8" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{getStaffOperationText("noOrders", locale)}</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>{getStaffOperationText("noOrdersHelp", locale)}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pendingOrders.map((order) => {
            const dateStr = order.createdAt
              ? locale === "ja"
                ? new Date(order.createdAt.toMillis()).toLocaleString("ja-JP", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : formatStaffShortDateTime(order.createdAt.toMillis(), locale)
              : "";
            const total = totalOrderQuantity(order.items);
            const isDelivery = order.deliveryType === "delivery";
            const memoList = [order.note, order.deliveryNote]
              .filter((memo): memo is string => Boolean(memo))
              .filter((memo, index, list) => list.indexOf(memo) === index);
            const status = getOrderStatusView(order, locale);
            const action = getOrderActionView(order, locale);
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
                        {order.customerName || getStaffOperationText("customerUnlinked", locale)}
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
                        {getStaffOperationText(isDelivery ? "delivery" : "pickup", locale)}
                      </span>
                      {isDelivery && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", background: "#f8fafc", padding: "4px 8px", borderRadius: 6 }}>
                          {getStaffOperationText("deliveryTarget", locale, {
                            target: order.deliveryTargetName || getStaffOperationText("notEntered", locale),
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6" }}>{total}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>
                      {getStaffTankUnit(total, locale)}
                    </span>
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
                        {item.tankType || getStaffOperationText("tankTypeMissing", locale)}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", whiteSpace: "nowrap" }}>
                        {getStaffOperationText("quantityTanks", locale, {
                          countLabel: formatStaffTankCount(item.quantity, locale),
                        })}
                      </span>
                    </div>
                  ))}
                </div>

                {memoList.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {memoList.map((memo) => (
                      <p key={memo} style={{
                        margin: 0,
                        fontSize: 12,
                        color: "#64748b",
                        fontWeight: 600,
                        overflowWrap: "anywhere",
                      }}>
                        {getStaffOperationText("memo", locale, { memo })}
                      </p>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {action.kind === "approve" && (
                    <button
                      type="button"
                      aria-busy={isApproving}
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
                      {getStaffOperationText(isApproving ? "approving" : "approveOrder", locale)}
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
                      {getStaffOperationText("openTankInput", locale)}
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

export function getOrderStatusView(order: PendingOrder, locale: Locale): {
  label: string;
  color: string;
  background: string;
} {
  if (!order.customerId || order.status === "pending_link") {
    return { label: getStaffOperationText("statusPendingLink", locale), color: "#92400e", background: "#fef3c7" };
  }
  if (order.status === "approved") {
    return { label: getStaffOperationText("statusApproved", locale), color: "#047857", background: "#d1fae5" };
  }
  if (order.status === "completed") {
    return { label: getStaffOperationText("statusCompleted", locale), color: "#475569", background: "#e2e8f0" };
  }
  if (order.status === "pending_approval") {
    return { label: getStaffOperationText("statusPendingApproval", locale), color: "#1d4ed8", background: "#dbeafe" };
  }
  return { label: getStaffOperationText("statusPending", locale), color: "#1d4ed8", background: "#dbeafe" };
}

export function getOrderActionView(order: PendingOrder, locale: Locale):
  | { kind: "approve" }
  | { kind: "fulfill" }
  | { kind: "disabled"; label: string } {
  if (!order.customerId || order.status === "pending_link") {
    return { kind: "disabled", label: getStaffOperationText("statusPendingLink", locale) };
  }
  if (order.status === "approved") {
    return { kind: "fulfill" };
  }
  if (order.status === "pending" || order.status === "pending_approval") {
    return { kind: "approve" };
  }
  return { kind: "disabled", label: getStaffOperationText("statusCompleted", locale) };
}
