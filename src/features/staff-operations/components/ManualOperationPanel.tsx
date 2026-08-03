"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Building2, Check, Loader2, Send, Trash2, X } from "lucide-react";
import DrumRoll from "@/components/DrumRoll";
import QuickSelect from "@/components/QuickSelect";
import type { QuickSelectOption } from "@/components/QuickSelect";
import ReturnTagSelector, { getReturnTagLabel, getReturnTagStyle } from "@/components/ReturnTagSelector";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import { getTankStatusLabel } from "@/lib/tank-action-status-labels";
import type { Locale } from "@/lib/locale";
import type { CustomerSnapshot } from "@/lib/operation-context";
import { formatStaffCount } from "@/lib/staff-display";
import type { UseManualTankOperationResult } from "../hooks/useManualTankOperation";
import { getStaffOperationText } from "../i18n";
import styles from "../styles/OperationsTerminal.module.css";
import type { ModeConfigItem, OpMode, QueueItem, TagType } from "../types";

interface ManualOperationPanelProps {
  mode: OpMode;
  config: ModeConfigItem;
  operationLabel: string;
  locale: Locale;
  prefixes: string[];
  customerOptions?: QuickSelectOption[];
  selectedCustomerId?: string;
  setSelectedCustomerId?: (customerId: string) => void;
  manual: UseManualTankOperationResult;
  onBack?: () => void;
  dataLoading?: boolean;
  dataLoadFailed?: boolean;
  retryData?: () => void | Promise<void>;
}

/** 全削除は 2 段階。armed のまま放置された場合は自動で解除する */
const CLEAR_ARM_TIMEOUT_MS = 4000;

export default function ManualOperationPanel({
  mode,
  config,
  operationLabel,
  locale,
  prefixes,
  customerOptions = [],
  selectedCustomerId = "",
  setSelectedCustomerId,
  manual,
  onBack,
  dataLoading = false,
  dataLoadFailed = false,
  retryData,
}: ManualOperationPanelProps) {
  const {
    returnTag,
    setReturnTag,
    opQueue,
    activePrefix,
    setActivePrefix,
    inputValue,
    inputRef,
    lastAdded,
    submitting,
    validCount,
    focusInput,
    handleInputChange,
    handleManualOkTrigger,
    removeFromQueue,
    clearQueue,
    handleSubmit,
  } = manual;
  const isLend = mode === "lend";
  const isReturn = mode === "return";

  const formatStatusLabel = (status?: string): string => {
    const code = coerceTankStatusCode(status);
    if (code) return getTankStatusLabel(code, locale);
    return status || getStaffOperationText("unknownStatus", locale);
  };

  const customerSnapshotFromOption = (customerId: string): CustomerSnapshot | null => {
    const option = customerOptions.find((item) => typeof item !== "string" && item.value === customerId);
    if (!option || typeof option === "string") return null;
    return { customerId: option.value, customerName: option.label };
  };

  const handleCustomerConfirm = (customerId: string) => {
    const customer = customerSnapshotFromOption(customerId);
    if (!customer) {
      alert(getStaffOperationText("destinationLookupFailure", locale));
      return;
    }
    void handleSubmit(true, customer);
  };

  const showDestination = isLend && Boolean(setSelectedCustomerId);
  const hasContext = showDestination || isReturn;

  return (
    <div className={styles.workspace} data-mode={mode}>
      <div className={styles.commandPane}>
        {/* 隠し数字入力（フォーカス用）: position:absolute の祖先になるよう左カラムに配置 */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={handleInputChange}
          aria-label={getStaffOperationText("tankNumberInput", locale)}
          className={styles.hiddenInput}
        />

        {/* 読み込み中は帯を足さず、A-OK 自体が disabled ディスプレイになる（面を増やさない） */}
        {!dataLoading && dataLoadFailed && (
          <div role="alert" className={`${styles.notice} ${styles.noticeError}`}>
            <span>{getStaffOperationText("operationDataLoadFailure", locale)}</span>
            {retryData && (
              <button type="button" data-swipe-ignore="true" onClick={() => void retryData()} className={styles.noticeRetry}>
                {getStaffOperationText("retry", locale)}
              </button>
            )}
          </div>
        )}

        {/* Commit Display: 表示と確定を兼ねる。下スワイプの起点でもある */}
        <div data-staff-swipe-surface="confirm" className={styles.commitRow}>
          {isReturn && onBack && (
            <button
              type="button"
              data-swipe-ignore="true"
              aria-label={getStaffOperationText("back", locale)}
              onClick={onBack}
              className={styles.backButton}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <CommitDisplay
            activePrefix={activePrefix}
            inputValue={inputValue}
            lastAdded={lastAdded}
            dataLoading={dataLoading}
            submitting={submitting}
            locale={locale}
            onClick={handleManualOkTrigger}
          />
        </div>

        {/* Operation Queue: 送信ボタンを内側に含む唯一のスクロール領域 */}
        <OperationQueue
          opQueue={opQueue}
          showTagChip={isReturn}
          locale={locale}
          submitting={submitting}
          validCount={validCount}
          operationLabel={operationLabel}
          formatStatusLabel={formatStatusLabel}
          onRemove={removeFromQueue}
          onClear={clearQueue}
          onSubmit={() => handleSubmit(!isReturn)}
        />

        {/* Operation Context: 貸出＝貸出先 / 返却＝返却タグ / 充填＝なし */}
        {showDestination && (
          customerOptions.length > 0 ? (
            <div className={styles.context}>
              <QuickSelect
                variant="context"
                options={customerOptions}
                value={selectedCustomerId}
                onChange={setSelectedCustomerId!}
                onConfirm={handleCustomerConfirm}
                color={config.color}
                locale={locale}
                label={getStaffOperationText("destinationLabel", locale)}
                icon={<Building2 size={14} />}
                placeholder={getStaffOperationText("selectDestination", locale)}
                ariaLabel={getStaffOperationText("selectCustomerAndRun", locale)}
              />
            </div>
          ) : !dataLoading && !dataLoadFailed ? (
            <div className={styles.context}>
              <div role="status" className={styles.contextEmptyNote}>
                {getStaffOperationText("noActiveCustomers", locale)}
              </div>
            </div>
          ) : null
        )}

        {isReturn && (
          <div className={styles.context}>
            <ReturnTagSelector<TagType>
              variant="context"
              value={returnTag}
              onChange={setReturnTag}
              options={[
                { value: "uncharged", label: getReturnTagLabel("uncharged", locale) },
                { value: "unused", label: getReturnTagLabel("unused", locale) },
                { value: "keep", label: getReturnTagLabel("keep", locale) },
              ]}
              locale={locale}
            />
          </div>
        )}

        {/* optional が無い variant では Queue が下端まで伸びる。空白帯は残さない */}
        {hasContext && <div className={styles.bottomInset} />}
      </div>

      {/* Input Method Pane: 位置と操作方法は変えない */}
      <DrumRoll
        items={prefixes}
        value={activePrefix}
        onChange={(p) => setActivePrefix(p)}
        onSelect={(p) => focusInput(p)}
        accentColor={config.color}
        locale={locale}
        variant="soft"
        width="var(--ops-drum-w, 68px)"
      />
    </div>
  );
}

/* ============================================================
   Commit Display（A-OK）
   ============================================================ */

type CommitState = "idle" | "ready" | "typing" | "armed" | "added" | "disabled";

interface CommitDisplayProps {
  activePrefix: string | null;
  inputValue: string;
  lastAdded: string | null;
  dataLoading: boolean;
  submitting: boolean;
  locale: Locale;
  onClick: () => void;
}

function resolveCommitState(
  activePrefix: string | null,
  inputValue: string,
  lastAdded: string | null,
  busy: boolean,
): CommitState {
  if (busy) return "disabled";
  if (lastAdded) return "added";
  if (!activePrefix) return "idle";
  if (inputValue.length === 0) return "ready";
  return inputValue.length < 2 ? "typing" : "armed";
}

function CommitDisplay({ activePrefix, inputValue, lastAdded, dataLoading, submitting, locale, onClick }: CommitDisplayProps) {
  const state = resolveCommitState(activePrefix, inputValue, lastAdded, dataLoading || submitting);
  const addedParts = lastAdded ? lastAdded.split("-") : null;
  const prefix = state === "added" && addedParts ? addedParts[0] : activePrefix ?? "";
  /* 番号が空のときは OK 補完で確定できることを面の上で示す */
  const number = state === "added" && addedParts
    ? addedParts.slice(1).join("-")
    : inputValue || "OK";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "idle" || state === "disabled"}
      data-state={state}
      className={styles.commit}
    >
      {state === "disabled" && (dataLoading || !activePrefix) ? (
        /* マスタ取得中だけが文言を持つ。送信中は面のトーンだけを落として ID を残す */
        <span
          className={styles.commitPlaceholder}
          {...(dataLoading ? { role: "status" as const } : {})}
        >
          {getStaffOperationText(dataLoading ? "operationDataLoading" : "prefixNotSelected", locale)}
        </span>
      ) : state === "idle" ? (
        <span className={styles.commitPlaceholder}>
          {getStaffOperationText("prefixNotSelected", locale)}
        </span>
      ) : (
        <span className={styles.commitId}>
          <span className={styles.commitPrefix}>{prefix}</span>
          <span className={styles.commitSeparator}>–</span>
          <span className={styles.commitNumber}>
            {number}
            {state === "typing" && <span className={styles.commitCaret}>_</span>}
          </span>
          {state === "added" && (
            <span className={styles.commitCheck} aria-hidden="true">
              <Check size={20} strokeWidth={3} />
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/* ============================================================
   Operation Queue（送信リスト）
   ============================================================ */

interface OperationQueueProps {
  opQueue: QueueItem[];
  /** 返却では「タグなし（通常）」も明示し、意味を色だけに負わせない */
  showTagChip: boolean;
  locale: Locale;
  submitting: boolean;
  validCount: number;
  operationLabel: string;
  formatStatusLabel: (status?: string) => string;
  onRemove: (uid: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}

function OperationQueue({
  opQueue,
  showTagChip,
  locale,
  submitting,
  validCount,
  operationLabel,
  formatStatusLabel,
  onRemove,
  onClear,
  onSubmit,
}: OperationQueueProps) {
  /* 何件のリストに対して確認したかを持つ。件数が変われば確認は自動的に無効になる */
  const [armedForLength, setArmedForLength] = useState<number | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueLength = opQueue.length;
  const clearArmed = armedForLength === queueLength;

  useEffect(() => {
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, []);

  const handleClearClick = () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    if (clearArmed) {
      setArmedForLength(null);
      onClear();
      return;
    }
    setArmedForLength(queueLength);
    armTimerRef.current = setTimeout(() => setArmedForLength(null), CLEAR_ARM_TIMEOUT_MS);
  };

  const countUnit = getStaffOperationText(
    queueLength === 1 ? "queueUnitOne" : "queueUnitMany",
    locale,
  );

  return (
    <div className={styles.queue} data-empty={queueLength === 0}>
      <div className={styles.queueLegend}>
        <span className={styles.queueTitle}>
          <span className={styles.queueTitleText}>{getStaffOperationText("queue", locale)}</span>
          <span className={styles.queueCount}>{queueLength}</span>
          <span className={styles.queueCountUnit}>{countUnit}</span>
        </span>
        {queueLength > 0 && (
          <button
            type="button"
            data-swipe-ignore="true"
            data-armed={clearArmed}
            disabled={submitting}
            aria-label={getStaffOperationText("clearQueueAria", locale)}
            onClick={handleClearClick}
            className={styles.queueClear}
          >
            <span className={styles.queueClearBody}>
              <Trash2 size={12} aria-hidden="true" />
              {getStaffOperationText(clearArmed ? "clearQueueArmed" : "clearQueue", locale)}
            </span>
          </button>
        )}
      </div>

      <div className={styles.queueScroll}>
        {queueLength === 0 ? (
          <div className={styles.queueEmpty}>
            <p className={styles.queueEmptyLine}>{getStaffOperationText("choosePrefix", locale)}</p>
            <p className={styles.queueEmptyLine}>{getStaffOperationText("enterTankNumber", locale)}</p>
          </div>
        ) : (
          opQueue.map((item) => {
            const tone = !item.valid ? "bad" : item.recoveryCandidate ? "warn" : "normal";
            return (
              <div key={item.uid} className={styles.queueItem} data-tone={tone}>
                <span className={styles.queuePill} aria-hidden="true" />
                <div className={styles.queueItemBody}>
                  <div className={styles.queueItemHead}>
                    <span className={styles.queueItemId}>{item.tankId}</span>
                    {showTagChip && (
                      <span
                        className={`${styles.queueChip} ${styles.queueChipTag}`}
                        style={item.tag === "normal" ? undefined : {
                          background: getReturnTagStyle(item.tag).background,
                          color: getReturnTagStyle(item.tag).color,
                        }}
                      >
                        {getReturnTagLabel(item.tag, locale)}
                      </span>
                    )}
                    {tone === "warn" && (
                      <span className={`${styles.queueChip} ${styles.queueChipWarn}`}>
                        {getStaffOperationText("recoveryChip", locale)}
                      </span>
                    )}
                    {tone === "bad" && (
                      <span className={`${styles.queueChip} ${styles.queueChipBad}`}>
                        {getStaffOperationText("blockedChip", locale)}
                      </span>
                    )}
                  </div>
                  <div className={styles.queueItemStatus}>
                    {item.recoveryCandidate
                      ? `${getStaffOperationText("currentStatus", locale, { status: formatStatusLabel(item.status) })}${locale === "ja" ? " ・" : " · "}${getStaffOperationText("recoveryRequired", locale)}`
                      : item.valid
                        ? getStaffOperationText("currentStatus", locale, { status: formatStatusLabel(item.status) })
                        : item.error}
                  </div>
                </div>
                <button
                  type="button"
                  data-swipe-ignore="true"
                  aria-label={getStaffOperationText("removeTank", locale, { tankId: item.tankId })}
                  onClick={() => onRemove(item.uid)}
                  className={styles.queueRemove}
                >
                  <X size={15} strokeWidth={2.2} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* リストが空のうちは実行ボタンごと存在しない */}
      {queueLength > 0 && (
        <div className={styles.queueSubmitDock}>
          <button
            type="button"
            data-swipe-ignore="true"
            aria-busy={submitting}
            onClick={onSubmit}
            disabled={submitting || validCount === 0}
            className={styles.queueSubmit}
          >
            {submitting
              ? <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} />
              : <Send size={17} strokeWidth={2.2} />}
            <span>
              {getStaffOperationText("executeOperation", locale, {
                countLabel: formatStaffCount(validCount, locale, {
                  ja: "件", enSingular: "tank", enPlural: "tanks",
                }),
                operation: operationLabel,
              })}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
