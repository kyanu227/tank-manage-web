"use client";

import { ArrowLeft, CheckCircle2, Loader2, Store, Truck, X } from "lucide-react";
import DrumRoll from "@/components/DrumRoll";
import { totalOrderQuantity, type PendingOrder } from "@/lib/order-types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { formatStaffCount, formatStaffTankCount } from "@/lib/staff-display";
import type { UseOrderFulfillmentResult } from "../hooks/useOrderFulfillment";
import { getStaffOperationText } from "../i18n";
import type { TankMap } from "../types";

interface OrderFulfillmentScreenProps {
  selectedOrder: PendingOrder;
  prefixes: string[];
  allTanks: TankMap;
  fulfillment: UseOrderFulfillmentResult;
  locale?: Locale;
  dataLoading?: boolean;
  dataLoadFailed?: boolean;
  retryData?: () => void | Promise<void>;
}

export default function OrderFulfillmentScreen({
  selectedOrder,
  prefixes,
  allTanks,
  fulfillment,
  locale = DEFAULT_LOCALE,
  dataLoading = false,
  dataLoadFailed = false,
  retryData,
}: OrderFulfillmentScreenProps) {
  const {
    scannedTanks,
    orderActivePrefix,
    setOrderActivePrefix,
    orderInputValue,
    orderInputRef,
    orderLastAdded,
    orderSubmitting,
    closeFulfillment,
    orderFocusInput,
    handleOrderInputChange,
    handleOrderOkTrigger,
    removeScannedTank,
    fulfillOrder,
  } = fulfillment;
  const orderValidCount = scannedTanks.filter((t) => t.valid).length;
  // items 配列ベースで必要本数と種別ごとの完了状態を算出
  const requiredQty = totalOrderQuantity(selectedOrder.items);
  // 種別ごとのスキャン済み本数（valid のみ集計）
  const orderScannedByType = new Map<string, number>();
  scannedTanks.forEach((t) => {
    if (!t.valid) return;
    const tk = allTanks[t.id];
    const tType = tk?.type ?? "";
    orderScannedByType.set(tType, (orderScannedByType.get(tType) ?? 0) + 1);
  });
  // items 配列ベースで完了判定（全種別が必要本数に到達）
  const isReady = selectedOrder.items.every(
    (it) => (orderScannedByType.get(it.tankType) ?? 0) === it.quantity
  );
  const remaining = Math.max(0, requiredQty - orderValidCount);
  // ヘッダー用サマリー
  //  - 1種別: "スチール10L × 3本"
  //  - 複数種別: "2種・合計5本"（幅を食わないコンパクト表記）
  const isSingleType = selectedOrder.items.length === 1;
  const headerBadgeText = isSingleType
    ? `${selectedOrder.items[0].tankType} ${getStaffOperationText("quantityTanks", locale, {
        countLabel: formatStaffTankCount(selectedOrder.items[0].quantity, locale),
      })}`
    : getStaffOperationText("typeSummary", locale, {
        typeCountLabel: formatStaffCount(selectedOrder.items.length, locale, {
          ja: "種", enSingular: "type", enPlural: "types",
        }),
        tankCountLabel: formatStaffTankCount(requiredQty, locale),
      });
  const isDelivery = selectedOrder.deliveryType === "delivery";
  const memo = selectedOrder.note || selectedOrder.deliveryNote;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#f8fafc" }}>
      {/* 統合ヘッダー（1行・Packageアイコン無し） */}
      <div style={{ padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button type="button" aria-label={getStaffOperationText("back", locale)} onClick={closeFulfillment} style={{ width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", color: "#64748b" }}>
          <ArrowLeft size={16} />
        </button>
        {/* 顧客名 */}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedOrder.customerName}
          </p>
        </div>
        {/* 種別バッジ: 単一種別なら種別名+本数、複数種別なら要約 */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", padding: "4px 10px", background: "#eff6ff", borderRadius: 8, maxWidth: "45%", overflow: "hidden" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#1e40af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {headerBadgeText}
          </span>
        </div>
        {/* スキャン状況 X/Y */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", gap: 2 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: isReady ? "#10b981" : "#3b82f6", lineHeight: 1 }}>{orderValidCount}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>/ {requiredQty}</span>
        </div>
      </div>

      {dataLoading && (
        <div role="status" aria-label={getStaffOperationText("operationDataLoading", locale)} style={{ padding: "8px 16px", background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 800 }}>
          {getStaffOperationText("operationDataLoading", locale)}
        </div>
      )}
      {!dataLoading && dataLoadFailed && (
        <div role="alert" style={{ padding: "8px 16px", background: "#fef2f2", color: "#b91c1c", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>{getStaffOperationText("operationDataLoadFailure", locale)}</span>
          {retryData && (
            <button type="button" onClick={() => void retryData()} style={{ flexShrink: 0, border: "none", borderRadius: 8, padding: "6px 10px", background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
              {getStaffOperationText("retry", locale)}
            </button>
          )}
        </div>
      )}

      <div style={{ padding: "8px 16px", background: isDelivery ? "#f0f9ff" : "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 900, color: isDelivery ? "#0369a1" : "#475569" }}>
          {isDelivery ? <Truck size={14} /> : <Store size={14} />}
          {isDelivery
            ? getStaffOperationText("deliveryDetail", locale, {
                target: selectedOrder.deliveryTargetName || getStaffOperationText("deliveryTargetMissing", locale),
              })
            : getStaffOperationText("pickup", locale)}
        </span>
        {memo && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {getStaffOperationText("memo", locale, { memo })}
          </span>
        )}
      </div>

      {/* 種別別進捗（複数種別時のみ表示・コンパクト） */}
      {!isSingleType && (
        <div style={{ padding: "8px 16px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          {selectedOrder.items.map((it) => {
            const scanned = orderScannedByType.get(it.tankType) ?? 0;
            const done = scanned === it.quantity;
            const color = done ? "#10b981" : "#3b82f6";
            return (
              <div key={it.tankType} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 10px", background: done ? "#f0fdf4" : "#f8fafc", borderRadius: 8, minHeight: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.tankType}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color, lineHeight: 1 }}>{scanned}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>/ {it.quantity}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {/* 隠し数字入力（フォーカス用）: position:absolute の祖先になるよう左カラムに配置 */}
          <input
            ref={orderInputRef}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            value={orderInputValue}
            onChange={handleOrderInputChange}
            aria-label={getStaffOperationText("tankNumberInput", locale)}
            style={{ position: "absolute", opacity: 0, width: 1, height: 1, overflow: "hidden", pointerEvents: "none", caretColor: "transparent" }}
          />
          {/* OKボタン */}
          <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleOrderOkTrigger}
              disabled={!orderActivePrefix}
              style={{
                width: "100%", padding: "8px", borderRadius: 12, border: "none",
                background: orderLastAdded ? "#10b981" : (orderActivePrefix ? "#3b82f6" : "#e2e8f0"),
                color: (orderActivePrefix || orderLastAdded) ? "#fff" : "#94a3b8",
                fontSize: 20, fontWeight: 900,
                boxShadow: (orderActivePrefix || orderLastAdded) ? `0 4px 12px ${orderLastAdded ? "#10b981" : "#3b82f6"}40` : "none",
                cursor: orderActivePrefix ? "pointer" : "not-allowed",
                transition: "background 0.2s, box-shadow 0.2s",
              }}
            >
              {orderLastAdded
                ? orderLastAdded
                : (!orderActivePrefix ? getStaffOperationText("okInput", locale) : orderInputValue ? `${orderActivePrefix} - ${orderInputValue}` : `${orderActivePrefix} - OK`)}
            </button>
          </div>

          {/* スキャン済みリスト（下部にフローティングボタン分の余白を確保） */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16, paddingBottom: 96 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>{getStaffOperationText("scannedList", locale)}</span>
              {scannedTanks.length > 0 && (
                <span style={{ background: "#3b82f6", color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                  {scannedTanks.length}
                </span>
              )}
            </div>
            {scannedTanks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1" }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{getStaffOperationText("choosePrefix", locale)}</p>
                <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>{getStaffOperationText("enterTankNumber", locale)}</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {scannedTanks.map((item) => (
                  <div key={item.id} style={{ background: "#fff", padding: "12px 16px", borderRadius: 12, borderLeft: `5px solid ${item.valid ? "#3b82f6" : "#ef4444"}`, boxShadow: "0 2px 6px rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: "#0f172a" }}>{item.id}</span>
                      <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>{item.valid ? "OK" : item.error}</div>
                    </div>
                    <button type="button" aria-label={getStaffOperationText("removeTank", locale, { tankId: item.id })} onClick={() => removeScannedTank(item.id)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer" }}><X size={18} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Floating 受注完了ボタン（常時表示／isReady でないときは disabled） */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "12px 16px max(12px, env(safe-area-inset-bottom, 12px))",
            background: "linear-gradient(transparent, rgba(248,250,252,0.95) 20%)",
            zIndex: 20, pointerEvents: "none",
          }}>
            <button type="button" aria-busy={orderSubmitting} onClick={fulfillOrder} disabled={!isReady || orderSubmitting}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                background: isReady ? "#10b981" : "#cbd5e1",
                color: "#fff", fontSize: 16, fontWeight: 900,
                boxShadow: isReady ? "0 4px 16px rgba(16,185,129,0.25)" : "none",
                display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                cursor: !isReady ? "not-allowed" : (orderSubmitting ? "wait" : "pointer"),
                pointerEvents: "auto",
                transition: "background 0.15s, box-shadow 0.15s",
              }}>
              {orderSubmitting ? (
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              {isReady
                ? getStaffOperationText("completeOrder", locale, { customerName: selectedOrder.customerName })
                : getStaffOperationText(
                    remaining === 1 ? "scanRemainingOne" : "scanRemainingMany",
                    locale,
                    { count: remaining },
                  )}
            </button>
          </div>
        </div>

        {/* 循環ドラムロール（共通コンポーネント化） */}
        <DrumRoll
          items={prefixes}
          value={orderActivePrefix}
          onChange={(p) => setOrderActivePrefix(p)}
          onSelect={(p) => orderFocusInput(p)}
          accentColor="#3b82f6"
          locale={locale}
        />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
