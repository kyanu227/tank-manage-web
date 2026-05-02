"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useTanks } from "@/hooks/useTanks";
import { DEFAULT_OP_STYLE, MODE_CONFIG } from "./constants";
import { useBulkReturnByLocation } from "./hooks/useBulkReturnByLocation";
import { useDestinations } from "./hooks/useDestinations";
import { useManualTankOperation } from "./hooks/useManualTankOperation";
import { useOperationSwipe } from "./hooks/useOperationSwipe";
import { useOrderFulfillment } from "./hooks/useOrderFulfillment";
import { useReturnApprovals } from "./hooks/useReturnApprovals";
import BulkReturnByLocationPanel from "./components/BulkReturnByLocationPanel";
import ManualOperationPanel from "./components/ManualOperationPanel";
import OperationModeTabs from "./components/OperationModeTabs";
import OrderFulfillmentScreen from "./components/OrderFulfillmentScreen";
import OrderListPanel from "./components/OrderListPanel";
import ReturnApprovalScreen from "./components/ReturnApprovalScreen";
import ReturnRequestList from "./components/ReturnRequestList";
import type { OpMode, OpStyle } from "./types";

interface OperationsTerminalProps {
  initialMode: OpMode;
}

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

  // 操作完了後は tanks と destinations を両方再取得する（旧 fetchData 互換）。
  // これを怠ると allTanks が古いまま続けて validateTransition が走り、誤判定の原因になる。
  const fetchData = async () => {
    await Promise.all([refetchTanks(), destinations.fetchDestinations()]);
  };

  // 各業務フックの組み立て
  const bulk = useBulkReturnByLocation();
  const approvals = useReturnApprovals({ fetchBulkTanks: bulk.fetchBulkTanks });
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

  // モード変更時: 手動キューのリセット＋各モードのデータ取得
  useEffect(() => {
    manual.reset();
    if (mode === "lend") {
      orders.fetchOrders();
    }
    if (mode === "return") {
      approvals.fetchApprovals();
      bulk.fetchBulkTanks();
      approvals.setSelectedReturnGroup(null);
      setShowManualReturn(false);
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

  /* ─── 返却承認画面 ─── */
  if (mode === "return" && approvals.selectedReturnGroup) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#f8fafc", overflow: "hidden", overscrollBehavior: "contain" }}>
        <OperationModeTabs mode={mode} />
        <ReturnApprovalScreen
          selectedReturnGroup={approvals.selectedReturnGroup}
          approvals={approvals}
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
          openFulfillment={orders.openFulfillment}
        />
      )}

      {/* 返却モード: リクエスト + 全貸出タンク */}
      {mode === "return" && !showManualReturn && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <button
            onClick={() => setShowManualReturn(true)}
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

          <ReturnRequestList
            approvalsLoading={approvals.approvalsLoading}
            returnGroups={approvals.returnGroups}
            openReturnGroup={approvals.openReturnGroup}
          />

          <BulkReturnByLocationPanel bulk={bulk} />
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
