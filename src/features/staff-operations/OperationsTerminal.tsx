"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useTanks } from "@/hooks/useTanks";
import { STATUS } from "@/lib/tank-rules";
import { DEFAULT_OP_STYLE, MODE_CONFIG } from "./constants";
import { useBulkReturnByLocation } from "./hooks/useBulkReturnByLocation";
import { useDestinations } from "./hooks/useDestinations";
import { useManualTankOperation } from "./hooks/useManualTankOperation";
import { useOperationSwipe } from "./hooks/useOperationSwipe";
import { useOrderFulfillment } from "./hooks/useOrderFulfillment";
import { useReturnTagProcessing } from "./hooks/useReturnTagProcessing";
import BulkReturnByLocationPanel from "./components/BulkReturnByLocationPanel";
import ManualOperationPanel from "./components/ManualOperationPanel";
import OperationModeTabs from "./components/OperationModeTabs";
import OrderFulfillmentScreen from "./components/OrderFulfillmentScreen";
import OrderListPanel from "./components/OrderListPanel";
import ReturnTagProcessingScreen from "./components/ReturnTagProcessingScreen";
import ReturnRequestList from "./components/ReturnRequestList";
import ReturnSegmentGestureLauncher, {
  type ReturnSegmentKey,
  type ReturnSegmentStat,
} from "./components/ReturnSegmentGestureLauncher";
import type { OpMode, OpStyle } from "./types";

interface OperationsTerminalProps {
  initialMode: OpMode;
}

const RETURN_SEGMENT_CONFIG: Record<ReturnSegmentKey, Omit<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount">> = {
  customer_requests: {
    key: "customer_requests",
    label: "返却タグ処理待ち",
    shortLabel: "タグ待ち",
    color: "#10b981",
    background: "#ecfdf5",
  },
  long_term: {
    key: "long_term",
    label: "長期 / 持ち越し確認",
    shortLabel: "長期",
    color: "#d97706",
    background: "#fffbeb",
  },
  normal: {
    key: "normal",
    label: "通常返却",
    shortLabel: "通常",
    color: "#2563eb",
    background: "#eff6ff",
  },
};

export default function OperationsTerminal({ initialMode }: OperationsTerminalProps) {
  // mode は URL 由来で固定。ページ遷移時は OperationsTerminal 自体がリマウントされる。
  const mode: OpMode = initialMode;
  const config = MODE_CONFIG[mode];

  // 操作スタイル（手動/受注）はヘッダーのチップと同期
  const [opStyle, setOpStyle] = useState<OpStyle>(DEFAULT_OP_STYLE);
  useEffect(() => {
    const handler = (e: Event) => {
      setOpStyle((e as CustomEvent).detail as OpStyle);
    };
    window.addEventListener("opStyleChange", handler);
    return () => window.removeEventListener("opStyleChange", handler);
  }, []);

  // DrumRoll 操作中にページ全体へスクロールが逃げないよう、操作画面中だけロックする。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.style.overflow = "";
    };
  }, []);

  // 横スワイプでモード循環切替
  useOperationSwipe(mode);

  // マスターデータ
  const { tankMap: allTanks, prefixes, refetch: refetchTanks } = useTanks();
  const destinations = useDestinations();

  // 返却モード: 手動返却画面の表示フラグ
  const [showManualReturn, setShowManualReturn] = useState(false);
  const [activeReturnSegment, setActiveReturnSegment] = useState<ReturnSegmentKey | null>(null);

  // 操作完了後は tanks と destinations を両方再取得する（旧 fetchData 互換）。
  // これを怠ると allTanks が古いまま続けて validateTransition が走り、誤判定の原因になる。
  const fetchData = async () => {
    await Promise.all([refetchTanks(), destinations.fetchDestinations()]);
  };

  // 各業務フックの組み立て
  const bulk = useBulkReturnByLocation();
  const returnTagProcessing = useReturnTagProcessing({ fetchBulkTanks: bulk.fetchBulkTanks });
  const orders = useOrderFulfillment({
    allTanks,
    fetchData,
  });
  const manual = useManualTankOperation({
    mode,
    config,
    allTanks,
    selectedCustomer: destinations.selectedCustomer,
    fetchData,
  });

  const returnSegmentStats = useMemo<ReturnSegmentStat[]>(() => {
    const stats: Record<ReturnSegmentKey, ReturnSegmentStat> = {
      customer_requests: { ...RETURN_SEGMENT_CONFIG.customer_requests, customerCount: 0, tankCount: 0, taggedCount: 0 },
      long_term: { ...RETURN_SEGMENT_CONFIG.long_term, customerCount: 0, tankCount: 0, taggedCount: 0 },
      normal: { ...RETURN_SEGMENT_CONFIG.normal, customerCount: 0, tankCount: 0, taggedCount: 0 },
    };

    const returnTagWaitingTankCount = returnTagProcessing.returnGroups.reduce((sum, group) => sum + group.items.length, 0);
    stats.customer_requests.customerCount = returnTagProcessing.returnGroups.length;
    stats.customer_requests.tankCount = returnTagWaitingTankCount;
    stats.customer_requests.taggedCount = returnTagWaitingTankCount;

    bulk.locationKeys.forEach((loc) => {
      const tanks = bulk.groupedTanks[loc] ?? [];
      const hasRestoredTag = tanks.some((tank) => tank.tag !== "normal");
      if (hasRestoredTag) return;
      const segment: ReturnSegmentKey = tanks.some((tank) => tank.status === STATUS.UNRETURNED)
        ? "long_term"
        : "normal";
      stats[segment].customerCount += 1;
      stats[segment].tankCount += tanks.length;
      stats[segment].taggedCount += tanks.filter((tank) => tank.tag !== "normal").length;
    });

    return [stats.customer_requests, stats.long_term, stats.normal];
  }, [bulk.groupedTanks, bulk.locationKeys, returnTagProcessing.returnGroups]);

  const activeReturnSegmentStat = activeReturnSegment
    ? returnSegmentStats.find((segment) => segment.key === activeReturnSegment) ?? null
    : null;

  const openManualReturn = () => {
    setActiveReturnSegment(null);
    setShowManualReturn(true);
  };

  // モード変更時: 手動キューのリセット＋各モードのデータ取得
  useEffect(() => {
    manual.reset();
    if (mode === "lend") {
      orders.fetchOrders();
    }
    if (mode === "return") {
      returnTagProcessing.fetchPendingReturnTags();
      bulk.fetchBulkTanks();
      returnTagProcessing.setSelectedReturnGroup(null);
      setShowManualReturn(false);
      setActiveReturnSegment(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ─── 受注詳細画面（貸出・受注スタイル） ─── */
  if (mode === "lend" && opStyle === "order" && orders.selectedOrder) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden", overscrollBehavior: "contain" }}>
        <OperationModeTabs mode={mode} />
        <OrderFulfillmentScreen
          selectedOrder={orders.selectedOrder}
          prefixes={prefixes}
          allTanks={allTanks}
          fulfillment={orders}
        />
        <GlobalAnimations />
      </div>
    );
  }

  /* ─── 返却タグ処理画面 ─── */
  if (mode === "return" && returnTagProcessing.selectedReturnGroup) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden", overscrollBehavior: "contain" }}>
        <OperationModeTabs mode={mode} />
        <ReturnTagProcessingScreen
          selectedReturnGroup={returnTagProcessing.selectedReturnGroup}
          returnTagProcessing={returnTagProcessing}
        />
        <GlobalAnimations />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", flex: 1,
        background: "#f8fafc", overflow: "hidden",
        overscrollBehavior: "contain",
      }}
    >
      <OperationModeTabs mode={mode} />

      {/* 貸出モード: 手動 */}
      {mode === "lend" && opStyle === "manual" && (
        <ManualOperationPanel
          mode={mode}
          config={config}
          prefixes={prefixes}
          customerOptions={destinations.customerSelectOptions}
          selectedCustomerId={destinations.selectedCustomerId}
          setSelectedCustomerId={destinations.setSelectedCustomerId}
          manual={manual}
        />
      )}

      {/* 貸出モード: 受注一覧 */}
      {mode === "lend" && opStyle === "order" && !orders.selectedOrder && (
        <OrderListPanel
          ordersLoading={orders.ordersLoading}
          pendingOrders={orders.pendingOrders}
          approveOrder={orders.approveOrder}
          approvingOrderId={orders.approvingOrderId}
          openFulfillment={orders.openFulfillment}
        />
      )}

      {/* 返却モード: 返却タグ処理待ち + 全貸出タンク */}
      {mode === "return" && !showManualReturn && (
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <ReturnSegmentGestureLauncher
            activeSegment={activeReturnSegment}
            segments={returnSegmentStats}
            onSelectSegment={(segment) => {
              setShowManualReturn(false);
              setActiveReturnSegment(segment);
            }}
            onSelectManualReturn={openManualReturn}
          />

          <div style={{ height: "100%", overflowY: "auto", padding: 16 }}>
          <button
            onClick={openManualReturn}
            style={{
              width: "100%", padding: "10px", borderRadius: 12, border: "1.5px solid #e2e8f0",
              background: "#fff", color: "#10b981", fontSize: 13, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              cursor: "pointer", marginBottom: 16, transition: "all 0.15s",
            }}
          >
            <ArrowDownToLine size={16} />
            手動返却
          </button>

          {activeReturnSegment === "customer_requests" && activeReturnSegmentStat && (
            <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 14, background: activeReturnSegmentStat.background, color: activeReturnSegmentStat.color, fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span>
                {activeReturnSegmentStat.label} {activeReturnSegmentStat.customerCount}顧客 / {activeReturnSegmentStat.tankCount}本
              </span>
              <button
                type="button"
                onClick={() => setActiveReturnSegment(null)}
                style={{ border: "1px solid #d1fae5", background: "#fff", color: "#047857", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                全て表示
              </button>
            </div>
          )}

          {(activeReturnSegment === null || activeReturnSegment === "customer_requests") && (
            <ReturnRequestList
              pendingReturnTagsLoading={returnTagProcessing.pendingReturnTagsLoading}
              returnGroups={returnTagProcessing.returnGroups}
              openReturnTagGroup={returnTagProcessing.openReturnTagGroup}
            />
          )}

          {activeReturnSegment !== "customer_requests" && (
            <BulkReturnByLocationPanel
              bulk={bulk}
              activeSegment={activeReturnSegment}
              onClearSegment={() => setActiveReturnSegment(null)}
            />
          )}
          </div>
        </div>
      )}

      {/* 返却モード: 手動返却（ダイヤル入力） */}
      {mode === "return" && showManualReturn && (
        <ManualOperationPanel
          mode={mode}
          config={config}
          prefixes={prefixes}
          manual={manual}
          onBack={() => setShowManualReturn(false)}
        />
      )}

      {/* 充填モード: ダイヤル入力 */}
      {mode === "fill" && (
        <ManualOperationPanel
          mode={mode}
          config={config}
          prefixes={prefixes}
          manual={manual}
        />
      )}

      <GlobalAnimations />
    </div>
  );
}

function GlobalAnimations() {
  return (
    <style>{`
      @keyframes slideInUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes slideInLeft {
        from { opacity: 0; transform: translateX(-20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  );
}
