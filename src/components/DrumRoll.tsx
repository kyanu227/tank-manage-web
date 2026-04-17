"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ドラムロール型の項目選択UI（汎用）
 *
 * - 縦方向のスナップスクロールで項目を切り替える
 * - 無限ループのために items を repeatCount 倍に展開する
 * - items / itemHeight をもとに、コンテナの高さに合わせて gap を動的計算する
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
  /** 無限ループのための繰り返し回数。デフォルト 30 */
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
  repeatCount = 30,
  accentColor = "#3b82f6",
  inactiveColor = "#94a3b8",
  width = 70,
  ariaLabel,
}: DrumRollProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  // コンテナ高さに応じて動的に変わる gap と 1ブロックの高さ
  const [metrics, setMetrics] = useState({ gap: 16, blockHeight: itemHeight + 16 });

  // gap を動的計算する（全項目がコンテナに収まるように均等分散）
  useEffect(() => {
    const updateMetrics = () => {
      if (containerRef.current && items.length > 0) {
        const h = containerRef.current.offsetHeight;
        if (h > 0) {
          const n = items.length;
          const totalItemHeight = n * itemHeight;
          const availableSpace = h - 16 - totalItemHeight;
          const calculatedGap = n > 1 ? Math.max(16, availableSpace / (n - 1)) : 16;
          setMetrics({ gap: calculatedGap, blockHeight: itemHeight + calculatedGap });
        }
      }
    };
    updateMetrics();
    window.addEventListener("resize", updateMetrics);
    return () => window.removeEventListener("resize", updateMetrics);
  }, [items, itemHeight]);

  return (
    <div
      style={{
        width,
        background: "#fff",
        borderLeft: "1px solid #e2e8f0",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
      aria-label={ariaLabel}
    >
      {items.length > 0 && (
        <>
          {/* 選択枠（下段にオーバーレイ） */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 6,
              right: 6,
              height: itemHeight,
              border: `3px solid ${accentColor}`,
              borderRadius: 12,
              pointerEvents: "none",
              zIndex: 10,
              background: `${accentColor}0A`,
            }}
          />
          <div
            ref={containerRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const { blockHeight } = metrics;
              const rawIdx = Math.round(el.scrollTop / blockHeight);
              const wrappedIdx = rawIdx % items.length;
              if (items[wrappedIdx] && items[wrappedIdx] !== value) {
                onChange(items[wrappedIdx]);
              }
              // 無限ループ: 上下端近くで中央付近にジャンプ
              const cycleHeight = blockHeight * items.length;
              const totalHeight = cycleHeight * repeatCount;
              if (el.scrollTop < cycleHeight * 5) {
                el.scrollTop = el.scrollTop + cycleHeight * 10;
              } else if (el.scrollTop > totalHeight - cycleHeight * 5) {
                el.scrollTop = el.scrollTop - cycleHeight * 10;
              }
            }}
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              position: "relative",
              scrollSnapType: "y mandatory",
              scrollPaddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))",
            }}
          >
            {/* 上部のスペーサー（選択枠の位置を下段に固定） */}
            <div style={{ height: `calc(100% - ${metrics.blockHeight}px)`, flexShrink: 0 }} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: metrics.gap,
                padding: "0 6px max(12px, env(safe-area-inset-bottom, 12px)) 6px",
              }}
            >
              {Array(repeatCount)
                .fill(items)
                .flat()
                .map((p: T, index: number) => {
                  const isActive = value === p;
                  return (
                    <div key={`${p}-${index}`} style={{ scrollSnapAlign: "end", scrollSnapStop: "always" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          if (onSelect) onSelect(p);
                          else onChange(p);
                          e.currentTarget.scrollIntoView({ behavior: "smooth", block: "end" });
                        }}
                        style={{
                          width: "100%",
                          height: itemHeight,
                          borderRadius: 10,
                          flexShrink: 0,
                          border: "none",
                          background: "transparent",
                          color: isActive ? accentColor : inactiveColor,
                          fontSize: 22,
                          fontWeight: 900,
                          fontFamily: "monospace",
                          transition: "all 0.15s ease",
                          cursor: "pointer",
                          transform: isActive ? "scale(1.3)" : "scale(1.0)",
                        }}
                      >
                        {p}
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
