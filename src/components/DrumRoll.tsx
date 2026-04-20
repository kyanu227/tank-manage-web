"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BOTTOM_INSET = 16;
const SIDE_INSET = 6;
const MIN_GAP = 16;
const CYCLE_COUNT = 3;
const MIDDLE_CYCLE = 1;

type Metrics = {
  spacerHeight: number;
  gap: number;
  blockHeight: number;
};

const normalizeIndex = (index: number, length: number) => {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
};

/**
 * ドラムロール型の項目選択UI（汎用）
 *
 * - 旧実装と同じく、コンテナ高さから項目間gapを計算して全体に広げる
 * - items の30回複製は使わず、前後移動用に3周だけ描画する
 * - 初期位置は中央周へ寄せ、端に近づいたら中央周へ戻す
 * - 純粋な回転UIであり、ビジネスロジックには依存しない
 */
export type DrumRollProps<T extends string> = {
  /** 回転対象の項目配列 */
  items: readonly T[];
  /** 現在選択されている値 */
  value: T | null;
  /** 選択値が変わったときの通知（スクロール・クリック両方） */
  onChange: (value: T) => void;
  /**
   * クリックによる明示的な選択が発生したときの通知。
   * 省略時は onChange のみ発火する。
   * スクロール由来の選択変更と、タップによる選択変更を区別したいときに使う。
   */
  onSelect?: (value: T) => void;
  /** 1項目あたりの高さ（px）。デフォルト 48 */
  itemHeight?: number;
  /** 旧スクロール版との互換用。3周固定のため現在は使用しない */
  repeatCount?: number;
  /** アクティブ項目・選択枠のアクセント色。デフォルト #3b82f6 */
  accentColor?: string;
  /** 非アクティブ項目の文字色。デフォルト #94a3b8 */
  inactiveColor?: string;
  /** コンテナ幅（px）。デフォルト 70 */
  width?: number;
  /** アクセシビリティラベル */
  ariaLabel?: string;
};

export default function DrumRoll<T extends string>({
  items,
  value,
  onChange,
  onSelect,
  itemHeight = 48,
  accentColor = "#3b82f6",
  inactiveColor = "#94a3b8",
  width = 70,
  ariaLabel,
}: DrumRollProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollIgnoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreScrollRef = useRef(false);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
    moved: boolean;
  } | null>(null);

  const [metrics, setMetrics] = useState<Metrics>({
    spacerHeight: 0,
    gap: MIN_GAP,
    blockHeight: itemHeight + MIN_GAP,
  });

  const valueIndex = value == null ? -1 : items.indexOf(value);
  const selectedIndex = valueIndex >= 0 ? valueIndex : 0;

  const repeatedItems = useMemo(() => {
    return Array.from({ length: CYCLE_COUNT }, (_, cycle) =>
      items.map((item, index) => ({
        item,
        itemIndex: index,
        globalIndex: cycle * items.length + index,
      }))
    ).flat();
  }, [items]);

  const scrollToGlobalIndex = useCallback(
    (globalIndex: number, behavior: ScrollBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el || items.length === 0) return;

      el.scrollTo({
        top: globalIndex * metrics.blockHeight,
        behavior,
      });
    },
    [items.length, metrics.blockHeight]
  );

  const moveToMiddleCycle = useCallback(
    (itemIndex: number, behavior: ScrollBehavior = "auto") => {
      scrollToGlobalIndex(MIDDLE_CYCLE * items.length + itemIndex, behavior);
    },
    [items.length, scrollToGlobalIndex]
  );

  const nearestGlobalIndex = useCallback(
    (itemIndex: number) => {
      const el = containerRef.current;
      if (!el || items.length === 0) return MIDDLE_CYCLE * items.length + itemIndex;

      const currentGlobalIndex = Math.round(el.scrollTop / metrics.blockHeight);
      const currentCycle = Math.round((currentGlobalIndex - itemIndex) / items.length);
      const candidates = [currentCycle - 1, currentCycle, currentCycle + 1].map(
        (cycle) => cycle * items.length + itemIndex
      );

      return candidates.reduce((best, candidate) => {
        return Math.abs(candidate - currentGlobalIndex) < Math.abs(best - currentGlobalIndex)
          ? candidate
          : best;
      }, candidates[0]);
    },
    [items.length, metrics.blockHeight]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateMetrics = () => {
      const height = el.offsetHeight;
      if (height <= 0 || items.length === 0) return;

      const totalItemHeight = items.length * itemHeight;
      const availableGapSpace = height - BOTTOM_INSET - totalItemHeight;
      const gap = items.length > 1
        ? Math.max(MIN_GAP, availableGapSpace / (items.length - 1))
        : MIN_GAP;
      const nextMetrics = {
        spacerHeight: Math.max(0, height - BOTTOM_INSET - itemHeight),
        gap,
        blockHeight: itemHeight + gap,
      };

      setMetrics((current) => {
        if (
          Math.abs(current.spacerHeight - nextMetrics.spacerHeight) < 0.5 &&
          Math.abs(current.gap - nextMetrics.gap) < 0.5 &&
          Math.abs(current.blockHeight - nextMetrics.blockHeight) < 0.5
        ) {
          return current;
        }
        return nextMetrics;
      });
    };

    updateMetrics();
    const raf = requestAnimationFrame(updateMetrics);

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateMetrics);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", updateMetrics);
      };
    }

    const observer = new ResizeObserver(updateMetrics);
    observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [items.length, itemHeight]);

  useEffect(() => {
    if (items.length === 0) return;

    ignoreScrollRef.current = true;
    moveToMiddleCycle(selectedIndex, "auto");

    const timer = setTimeout(() => {
      ignoreScrollRef.current = false;
    }, 0);

    return () => clearTimeout(timer);
  }, [items.length, metrics.blockHeight, moveToMiddleCycle, selectedIndex]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (scrollIgnoreTimerRef.current) clearTimeout(scrollIgnoreTimerRef.current);
    };
  }, []);

  const ignoreIntermediateScroll = useCallback((durationMs: number) => {
    ignoreScrollRef.current = true;
    if (scrollIgnoreTimerRef.current) clearTimeout(scrollIgnoreTimerRef.current);
    scrollIgnoreTimerRef.current = setTimeout(() => {
      ignoreScrollRef.current = false;
    }, durationMs);
  }, []);

  const settleToNearestItem = useCallback(() => {
    const el = containerRef.current;
    if (!el || items.length === 0) return;

    const globalIndex = Math.round(el.scrollTop / metrics.blockHeight);
    scrollToGlobalIndex(globalIndex, "smooth");
  }, [items.length, metrics.blockHeight, scrollToGlobalIndex]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || items.length === 0) return;

    const globalIndex = Math.round(el.scrollTop / metrics.blockHeight);
    const itemIndex = normalizeIndex(globalIndex, items.length);
    const nextItem = items[itemIndex];

    if (!ignoreScrollRef.current && nextItem && nextItem !== value) {
      onChange(nextItem);
    }

    const cycleHeight = metrics.blockHeight * items.length;
    if (globalIndex < items.length) {
      el.scrollTop += cycleHeight;
    } else if (globalIndex >= items.length * 2) {
      el.scrollTop -= cycleHeight;
    }

    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(settleToNearestItem, 120);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || items.length <= 1) return;
    if ((e.target as HTMLElement).closest("[data-drum-roll-option='true']")) return;

    const el = containerRef.current;
    if (!el) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScrollTop: el.scrollTop,
      moved: false,
    };
    suppressClickRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    const drag = dragRef.current;
    if (!el || !drag || drag.pointerId !== e.pointerId) return;

    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 4) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    el.scrollTop = drag.startScrollTop - dy;
  };

  const finishPointerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture が既に解除されているブラウザでは何もしない
    }

    dragRef.current = null;
    settleToNearestItem();

    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  return (
    <div
      style={{
        width,
        height: "100%",
        minHeight: 0,
        background: "#fff",
        borderLeft: "1px solid #e2e8f0",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {items.length > 0 && (
        <>
          {/* 選択枠（下段にオーバーレイ） */}
          <div
            style={{
              position: "absolute",
              bottom: BOTTOM_INSET,
              left: SIDE_INSET,
              right: SIDE_INSET,
              height: itemHeight,
              border: `3px solid ${accentColor}`,
              borderRadius: 8,
              pointerEvents: "none",
              zIndex: 10,
              background: `${accentColor}0A`,
            }}
          />
          <div
            ref={containerRef}
            className="no-scrollbar"
            role="listbox"
            aria-label={ariaLabel ?? "プレフィックス選択"}
            aria-activedescendant={
              value ? `drum-roll-option-${MIDDLE_CYCLE * items.length + selectedIndex}` : undefined
            }
            tabIndex={0}
            onScroll={handleScroll}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerDrag}
            onPointerCancel={finishPointerDrag}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              position: "relative",
              scrollSnapType: "y mandatory",
              scrollPaddingBottom: BOTTOM_INSET,
              overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              cursor: "grab",
            }}
          >
            <div style={{ height: metrics.spacerHeight, flexShrink: 0 }} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: metrics.gap,
                padding: `0 ${SIDE_INSET}px ${BOTTOM_INSET}px`,
              }}
            >
              {repeatedItems.map(({ item, itemIndex, globalIndex }) => {
                const isActive = value === item;
                return (
                  <div
                    key={`${item}-${globalIndex}`}
                    style={{
                      height: itemHeight,
                      flexShrink: 0,
                      scrollSnapAlign: "end",
                      scrollSnapStop: "always",
                    }}
                  >
                    <button
                      id={`drum-roll-option-${globalIndex}`}
                      data-drum-roll-option="true"
                      role="option"
                      aria-selected={isActive}
                      type="button"
                      onPointerDown={(e) => {
                        if (e.pointerType === "mouse") e.stopPropagation();
                      }}
                      onClick={() => {
                        if (suppressClickRef.current) return;

                        const targetGlobalIndex = nearestGlobalIndex(itemIndex);
                        ignoreIntermediateScroll(260);
                        if (onSelect) onSelect(item);
                        else onChange(item);
                        scrollToGlobalIndex(targetGlobalIndex, "smooth");
                      }}
                      style={{
                        width: "100%",
                        height: itemHeight,
                        borderRadius: 8,
                        border: "none",
                        background: "transparent",
                        color: isActive ? accentColor : inactiveColor,
                        fontSize: 22,
                        fontWeight: 900,
                        fontFamily: "monospace",
                        transition: "color 0.15s ease, transform 0.15s ease",
                        cursor: "pointer",
                        transform: isActive ? "scale(1.3)" : "scale(1)",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {item}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
