"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

const BOTTOM_INSET = 16;
const SIDE_INSET = 6;
const MIN_GAP = 16;
const CYCLE_COUNT = 3;
const MIDDLE_CYCLE = 1;

/** soft variant: 選択から離れるほど淡くして奥行きを作る */
const SOFT_INACTIVE_RAMP = ["#a8b2c1", "#b3bcc9", "#bfc7d3", "#cbd2dc"] as const;

function parseHexColor(hex: string): [number, number, number] | null {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** 選択中の文字だけは accent より一段深くして、屋外でも数字が沈まないようにする */
function deepen(hex: string, ratio = 0.26): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((channel) => Math.round(channel * (1 - ratio)));
  return `rgb(${r}, ${g}, ${b})`;
}

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
  /** コンテナ幅。数値は px、文字列は CSS 値（`var(--ops-drum-w)` など）。デフォルト 70 */
  width?: number | string;
  /**
   * 見た目のバリアント。
   * - framed: 縦線＋選択枠（既存の維持系画面）
   * - soft: 縦線と選択枠を持たず、内側影と輪郭のないにじみで示す（操作系画面の視覚正本）
   */
  variant?: "framed" | "soft";
  /** アクセシビリティラベル */
  ariaLabel?: string;
  locale?: Locale;
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
  variant = "framed",
  ariaLabel,
  locale = DEFAULT_LOCALE,
}: DrumRollProps<T>) {
  const isSoft = variant === "soft";
  const containerRef = useRef<HTMLDivElement>(null);
  const optionIdPrefix = useId();
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

  /*
    soft variant の選択表現。
    輪郭を持たない楕円のにじみだけで示し、枠線も枠線周囲の gradient も置かない。
    未選択のときは accent ではなく中立色でにじませる。
  */
  const bloomHeight = Math.round(itemHeight * 1.9);
  const bloomTint = value == null
    /* 未選択のにじみは位置合図に留める。白地でグレーの塊として読めない濃さまで落とす */
    ? ["rgba(15, 23, 42, 0.035)", "rgba(15, 23, 42, 0.022)", "rgba(15, 23, 42, 0.008)", "rgba(15, 23, 42, 0)"]
    : [
        withAlpha(accentColor, 0.26),
        withAlpha(accentColor, 0.13),
        withAlpha(accentColor, 0.04),
        withAlpha(accentColor, 0),
      ];

  return (
    <div
      data-swipe-ignore="true"
      style={{
        width,
        height: "100%",
        minHeight: 0,
        background: isSoft ? "var(--ops-drum-fill, rgba(255, 255, 255, 0.24))" : "#fff",
        ...(isSoft
          /*
            縦線ではなく内側の淡い影だけで奥行きを作る。
            境界としてはっきり読めてしまわない濃さに留める。
          */
          ? { boxShadow: "inset 18px 0 28px -24px rgba(15, 23, 42, 0.16)" }
          : { borderLeft: "1px solid #e2e8f0" }),
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: isSoft ? "hidden" : undefined,
      }}
    >
      {items.length > 0 && (
        <>
          {isSoft ? (
            <>
              {/* 上端 fade。面へ溶けることで「まだ続く＝回せる」を線なしで示す */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 36,
                  zIndex: 2,
                  pointerEvents: "none",
                  /* 溶ける先は pane 自身の面（＝白）。基底面の色を使うと上端が濁る */
                  background: "linear-gradient(180deg, var(--ops-drum-fill, #fff) 0%, transparent 100%)",
                }}
              />
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: -10,
                  right: -10,
                  bottom: BOTTOM_INSET + itemHeight / 2 - bloomHeight / 2,
                  height: bloomHeight,
                  pointerEvents: "none",
                  background: `radial-gradient(56% 50% at 50% 50%, ${bloomTint[0]} 0%, ${bloomTint[1]} 40%, ${bloomTint[2]} 70%, ${bloomTint[3]} 100%)`,
                  transition: "background 160ms linear",
                }}
              />
            </>
          ) : (
            /* 選択枠（下段にオーバーレイ） */
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
          )}
          <div
            ref={containerRef}
            className="no-scrollbar"
            role="listbox"
            aria-label={ariaLabel ?? (locale === "ja" ? "プレフィックス選択" : "Select a prefix")}
            aria-activedescendant={
              value ? `${optionIdPrefix}-option-${MIDDLE_CYCLE * items.length + selectedIndex}` : undefined
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
                const isAccessibleCycle = Math.floor(globalIndex / items.length) === MIDDLE_CYCLE;
                const distance = value == null
                  ? 1
                  : Math.min(
                      normalizeIndex(itemIndex - selectedIndex, items.length),
                      normalizeIndex(selectedIndex - itemIndex, items.length),
                    );
                const softColor = isActive
                  ? deepen(accentColor)
                  : SOFT_INACTIVE_RAMP[Math.min(Math.max(distance - 1, 0), SOFT_INACTIVE_RAMP.length - 1)];
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
                      id={`${optionIdPrefix}-option-${globalIndex}`}
                      data-drum-roll-option="true"
                      role="option"
                      aria-selected={isAccessibleCycle ? isActive : undefined}
                      aria-hidden={!isAccessibleCycle || undefined}
                      tabIndex={isAccessibleCycle ? 0 : -1}
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
                        color: isSoft ? softColor : (isActive ? accentColor : inactiveColor),
                        /* soft: 優先順位は文字サイズと色階調だけが担う（回転中のにじみを避けるため scale は使わない） */
                        fontSize: isSoft ? (isActive ? 27 : 21) : 22,
                        fontWeight: isSoft ? (isActive ? 800 : 700) : 900,
                        fontFamily: "monospace",
                        transition: isSoft
                          ? "color 0.15s ease, font-size 0.15s ease"
                          : "color 0.15s ease, transform 0.15s ease",
                        cursor: "pointer",
                        transform: isSoft || !isActive ? "scale(1)" : "scale(1.3)",
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
