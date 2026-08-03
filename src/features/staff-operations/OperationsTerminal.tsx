"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useTanks } from "@/hooks/useTanks";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import { DEFAULT_OP_STYLE, getOperationModeLabel, MODE_CONFIG } from "./constants";
import { useBulkReturnByLocation } from "./hooks/useBulkReturnByLocation";
import { useCustomerOptions } from "./hooks/useCustomerOptions";
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
import ReturnBoardEmpty from "./components/ReturnBoardEmpty";
import ReturnSegmentGestureLauncher, {
  type ReturnSegmentKey,
  type ReturnSegmentStat,
} from "./components/ReturnSegmentGestureLauncher";
import { getStaffOperationText } from "./i18n";
import { RETURN_SEGMENT_ORDER, resolveVisibleReturnSegments } from "./return-board-segments";
import styles from "./styles/OperationsTerminal.module.css";
import type { OpMode, OpStyle } from "./types";

interface OperationsTerminalProps {
  initialMode: OpMode;
}

const RETURN_UI_TEXT = {
  manualReturn: {
    ja: "手動返却",
    en: "Manual return",
  },
} satisfies Record<string, Record<Locale, string>>;

const RETURN_SEGMENT_LABELS = {
  normal: {
    ja: { label: "通常返却", shortLabel: "通常" },
    en: { label: "Normal returns", shortLabel: "Normal" },
  },
  customer_requests: {
    ja: { label: "返却タグ処理待ち", shortLabel: "タグ待ち" },
    en: { label: "Pending return tags", shortLabel: "Tags" },
  },
  long_term: {
    ja: { label: "長期貸出", shortLabel: "長期" },
    en: { label: "Long-term rentals", shortLabel: "Long-term" },
  },
} satisfies Record<ReturnSegmentKey, Record<Locale, Pick<ReturnSegmentStat, "label" | "shortLabel">>>;

type ReturnSegmentStyle = Pick<ReturnSegmentStat, "key" | "color" | "background">;

const RETURN_SEGMENT_CONFIG: Record<ReturnSegmentKey, ReturnSegmentStyle> = {
  normal: {
    key: "normal",
    color: "#0891b2",
    background: "#ecfeff",
  },
  customer_requests: {
    key: "customer_requests",
    color: "#10b981",
    background: "#ecfdf5",
  },
  long_term: {
    key: "long_term",
    color: "#be123c",
    background: "#fff1f2",
  },
};

function getReturnSegmentConfig(
  segment: ReturnSegmentKey,
  locale: Locale,
): Omit<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount"> {
  return {
    ...RETURN_SEGMENT_CONFIG[segment],
    ...RETURN_SEGMENT_LABELS[segment][locale],
  };
}

export default function OperationsTerminal({ initialMode }: OperationsTerminalProps) {
  // mode は URL 由来で固定。ページ遷移時は OperationsTerminal 自体がリマウントされる。
  const mode: OpMode = initialMode;
  const config = MODE_CONFIG[mode];
  const staffLocale = useStaffLocale();
  const modeLabel = getOperationModeLabel(mode, staffLocale);

  // 操作スタイル（手動/受注）はヘッダーのチップと同期
  const [opStyle, setOpStyle] = useState<OpStyle>(DEFAULT_OP_STYLE);
  useEffect(() => {
    const handler = (e: Event) => {
      setOpStyle((e as CustomEvent).detail as OpStyle);
    };
    window.addEventListener("opStyleChange", handler);
    return () => window.removeEventListener("opStyleChange", handler);
  }, []);

  // ページスクロールの禁止は staff shell の viewport policy が持つ
  // （lib/staff-viewport-policy）。ここでは何もしない。

  // 横スワイプでモード循環切替
  useOperationSwipe(mode);

  // マスターデータ
  const {
    tankMap: allTanks,
    prefixes,
    loading: tanksLoading,
    loadFailed: tanksLoadFailed,
    refetch: refetchTanks,
  } = useTanks();
  const customerOptionsState = useCustomerOptions();

  // 返却モード: 手動返却画面の表示フラグ
  const [showManualReturn, setShowManualReturn] = useState(false);
  const [activeReturnSegment, setActiveReturnSegment] = useState<ReturnSegmentKey | null>(null);

  // 操作完了後は tanks と customer options を両方再取得する（旧 fetchData 互換）。
  // これを怠ると allTanks が古いまま続けて validateTransition が走り、誤判定の原因になる。
  const fetchData = async () => {
    await Promise.all([refetchTanks(), customerOptionsState.fetchCustomerOptions()]);
  };

  // 各業務フックの組み立て
  const bulk = useBulkReturnByLocation();
  const returnTagProcessing = useReturnTagProcessing({
    fetchBulkTanks: bulk.fetchBulkTanks,
    locale: staffLocale,
  });
  const orders = useOrderFulfillment({
    allTanks,
    fetchData,
    locale: staffLocale,
  });
  const manual = useManualTankOperation({
    mode,
    config,
    locale: staffLocale,
    allTanks,
    selectedCustomer: customerOptionsState.selectedCustomer,
    fetchData,
  });

  const returnSegmentStats = useMemo<ReturnSegmentStat[]>(() => {
    const stats: Record<ReturnSegmentKey, ReturnSegmentStat> = {
      customer_requests: { ...getReturnSegmentConfig("customer_requests", staffLocale), customerCount: 0, tankCount: 0, taggedCount: 0 },
      long_term: { ...getReturnSegmentConfig("long_term", staffLocale), customerCount: 0, tankCount: 0, taggedCount: 0 },
      normal: { ...getReturnSegmentConfig("normal", staffLocale), customerCount: 0, tankCount: 0, taggedCount: 0 },
    };

    const returnTagWaitingTankCount = returnTagProcessing.returnGroups.reduce((sum, group) => sum + group.items.length, 0);
    stats.customer_requests.customerCount = returnTagProcessing.returnGroups.length;
    stats.customer_requests.tankCount = returnTagWaitingTankCount;
    stats.customer_requests.taggedCount = returnTagWaitingTankCount;

    const customerGroupsBySegment: Record<Extract<ReturnSegmentKey, "normal" | "long_term">, Set<string>> = {
      long_term: new Set(),
      normal: new Set(),
    };

    bulk.groupKeys.forEach((groupKey) => {
      const tanks = bulk.groupedTanks[groupKey] ?? [];
      const meta = bulk.groupMeta[groupKey];
      const segment: Extract<ReturnSegmentKey, "normal" | "long_term"> = meta?.pool === "long_term"
        ? "long_term"
        : "normal";
      if (meta) customerGroupsBySegment[segment].add(meta.key);
      stats[segment].customerCount += 1;
      stats[segment].tankCount += tanks.length;
      stats[segment].taggedCount += tanks.filter((tank) => tank.tag !== "normal").length;
    });
    stats.normal.customerCount = customerGroupsBySegment.normal.size;
    stats.long_term.customerCount = customerGroupsBySegment.long_term.size;

    return RETURN_SEGMENT_ORDER.map((segment) => stats[segment]);
  }, [bulk.groupMeta, bulk.groupKeys, bulk.groupedTanks, returnTagProcessing.returnGroups, staffLocale]);

  /*
    対象がゼロの区分は見出しごと描かない。
    ただし読み込み中・失敗中は状態を伝えるために描き、
    ジェスチャーで明示的に選ばれた区分も（対象ゼロでも）その区分の表示を残す。
  */
  const visibleReturnSegments = useMemo<ReturnSegmentKey[]>(() => resolveVisibleReturnSegments({
    activeSegment: activeReturnSegment,
    segments: returnSegmentStats,
    bulkBusy: bulk.bulkLoading || bulk.bulkLoadFailed,
    tagsBusy: returnTagProcessing.pendingReturnTagsLoading
      || returnTagProcessing.pendingReturnTagsLoadFailed,
  }), [
    activeReturnSegment,
    bulk.bulkLoadFailed,
    bulk.bulkLoading,
    returnSegmentStats,
    returnTagProcessing.pendingReturnTagsLoadFailed,
    returnTagProcessing.pendingReturnTagsLoading,
  ]);

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
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", overscrollBehavior: "contain" }}>
        <OperationModeTabs mode={mode} locale={staffLocale} />
        <OrderFulfillmentScreen
          selectedOrder={orders.selectedOrder}
          prefixes={prefixes}
          allTanks={allTanks}
          fulfillment={orders}
          locale={staffLocale}
          dataLoading={tanksLoading}
          dataLoadFailed={tanksLoadFailed}
          retryData={refetchTanks}
        />
        <GlobalAnimations />
      </div>
    );
  }

  /* ─── 返却タグ処理画面 ─── */
  if (mode === "return" && returnTagProcessing.selectedReturnGroup) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", overscrollBehavior: "contain" }}>
        <OperationModeTabs mode={mode} locale={staffLocale} />
        <ReturnTagProcessingScreen
          selectedReturnGroup={returnTagProcessing.selectedReturnGroup}
          returnTagProcessing={returnTagProcessing}
          locale={staffLocale}
        />
        <GlobalAnimations />
      </div>
    );
  }

  return (
    /*
      面は 1 枚。ここで独自の背景色を敷くと、shell の面との間に帯が生まれる。
      沈みは Input Workspace / 返却一覧の下部 gradient だけが持つ。
    */
    <div
      style={{
        display: "flex", flexDirection: "column", flex: 1,
        overflow: "hidden",
        overscrollBehavior: "contain",
      }}
    >
      <OperationModeTabs mode={mode} locale={staffLocale} />

      {/* 貸出モード: 手動 */}
      {mode === "lend" && opStyle === "manual" && (
        <ManualOperationPanel
          mode={mode}
          config={config}
          operationLabel={modeLabel}
          locale={staffLocale}
          prefixes={prefixes}
          customerOptions={customerOptionsState.customerSelectOptions}
          selectedCustomerId={customerOptionsState.selectedCustomerId}
          setSelectedCustomerId={customerOptionsState.setSelectedCustomerId}
          manual={manual}
          dataLoading={tanksLoading || customerOptionsState.loading}
          dataLoadFailed={tanksLoadFailed || customerOptionsState.loadFailed}
          retryData={fetchData}
        />
      )}

      {/* 貸出モード: 受注一覧 */}
      {mode === "lend" && opStyle === "order" && !orders.selectedOrder && (
        <OrderListPanel
          ordersLoading={orders.ordersLoading}
          ordersLoadFailed={orders.ordersLoadFailed}
          pendingOrders={orders.pendingOrders}
          approveOrder={orders.approveOrder}
          approvingOrderId={orders.approvingOrderId}
          openFulfillment={orders.openFulfillment}
          retryOrders={orders.fetchOrders}
          locale={staffLocale}
        />
      )}

      {/* 返却モード: 返却タグ処理待ち + 全貸出タンク */}
      {mode === "return" && !showManualReturn && (
        <div className={styles.returnBoard} data-mode="return">
          <ReturnSegmentGestureLauncher
            activeSegment={activeReturnSegment}
            segments={returnSegmentStats}
            locale={staffLocale}
            onSelectSegment={(segment) => {
              setShowManualReturn(false);
              setActiveReturnSegment(segment);
            }}
            onSelectManualReturn={openManualReturn}
          />

          <div className={styles.returnScroll}>
            <button
              type="button"
              onClick={openManualReturn}
              className={styles.manualReturnRow}
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
              {RETURN_UI_TEXT.manualReturn[staffLocale]}
              <span className={styles.manualReturnHint}>
                {getStaffOperationText("manualReturnDialHint", staffLocale)}
              </span>
            </button>

            {/*
              区分は見出しだけで表され、切替 UI としては現れない。
              区分の切替は右端の既存ジェスチャーが持つ。
            */}
            {visibleReturnSegments.length === 0 ? (
              <ReturnBoardEmpty locale={staffLocale} />
            ) : (
              visibleReturnSegments.map((segment) => (
                segment === "customer_requests" ? (
                  <ReturnRequestList
                    key={segment}
                    pendingReturnTagsLoading={returnTagProcessing.pendingReturnTagsLoading}
                    loadFailed={returnTagProcessing.pendingReturnTagsLoadFailed}
                    returnGroups={returnTagProcessing.returnGroups}
                    openReturnTagGroup={returnTagProcessing.openReturnTagGroup}
                    locale={staffLocale}
                    retry={returnTagProcessing.fetchPendingReturnTags}
                  />
                ) : (
                  <BulkReturnByLocationPanel
                    key={segment}
                    bulk={bulk}
                    activeSegment={segment}
                  />
                )
              ))
            )}
          </div>
        </div>
      )}

      {/* 返却モード: 手動返却（ダイヤル入力） */}
      {mode === "return" && showManualReturn && (
        <ManualOperationPanel
          mode={mode}
          config={config}
          operationLabel={modeLabel}
          locale={staffLocale}
          prefixes={prefixes}
          manual={manual}
          onBack={() => setShowManualReturn(false)}
          dataLoading={tanksLoading}
          dataLoadFailed={tanksLoadFailed}
          retryData={refetchTanks}
        />
      )}

      {/* 充填モード: ダイヤル入力 */}
      {mode === "fill" && (
        <ManualOperationPanel
          mode={mode}
          config={config}
          operationLabel={modeLabel}
          locale={staffLocale}
          prefixes={prefixes}
          manual={manual}
          dataLoading={tanksLoading}
          dataLoadFailed={tanksLoadFailed}
          retryData={refetchTanks}
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
