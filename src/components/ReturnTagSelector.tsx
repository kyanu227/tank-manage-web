"use client";

import { AlertCircle, Clock, Droplets, type LucideIcon } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { getReturnTagLabel as getLocalizedReturnTagLabel } from "@/lib/return-tag-labels";
import type { ReturnTag } from "@/lib/return-tag-rules";

export type ReturnTagValue = ReturnTag;

export interface ReturnTagOption {
  value: Exclude<ReturnTagValue, "normal">;
  label: string;
}

interface ReturnTagSelectorProps<T extends ReturnTagValue = ReturnTagValue> {
  value: T;
  onChange: (value: T) => void;
  options: ReturnTagOption[];
  enableSwipe?: boolean;
  swipeLeftValue?: T;
  swipeRightValue?: T;
  compact?: boolean;
  stackedLabels?: boolean;
  locale?: Locale;
  ariaLabel?: string;
  /**
   * 見た目のバリアント。
   * - chip: 枠を持つ独立したボタン列
   * - context: 面の上に置く 1 行（高さは親が配る）。枠線は持たず inset のみ
   */
  variant?: "chip" | "context";
}

const TAG_STYLES: Record<Exclude<ReturnTagValue, "normal">, {
  color: string;
  background: string;
  border: string;
  icon: LucideIcon;
}> = {
  unused: {
    color: "#10b981",
    background: "#ecfdf5",
    border: "#6ee7b7",
    icon: Droplets,
  },
  uncharged: {
    color: "#ef4444",
    background: "#fef2f2",
    border: "#fca5a5",
    icon: AlertCircle,
  },
  keep: {
    color: "#f59e0b",
    background: "#fffbeb",
    border: "#fcd34d",
    icon: Clock,
  },
};

export function getReturnTagStyle(value: ReturnTagValue): {
  color: string;
  background: string;
  border: string;
} {
  if (value === "normal") {
    return { color: "#64748b", background: "#f8fafc", border: "#e2e8f0" };
  }
  return TAG_STYLES[value];
}

export function getReturnTagLabel(
  value: ReturnTagValue,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getLocalizedReturnTagLabel(value, locale);
}

export default function ReturnTagSelector<T extends ReturnTagValue = ReturnTagValue>({
  value,
  onChange,
  options,
  enableSwipe = false,
  swipeLeftValue,
  swipeRightValue,
  compact = false,
  stackedLabels = false,
  locale = DEFAULT_LOCALE,
  ariaLabel,
  variant = "chip",
}: ReturnTagSelectorProps<T>) {
  const isContext = variant === "context";
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const selectValue = (nextValue: ReturnTagValue) => {
    onChange((value === nextValue ? "normal" : nextValue) as T);
  };

  const handlePointerUp = (x: number, y: number) => {
    if (!enableSwipe || !pointerStart.current) return;
    const dx = x - pointerStart.current.x;
    const dy = y - pointerStart.current.y;
    pointerStart.current = null;

    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    const nextValue = dx > 0 ? swipeRightValue : swipeLeftValue;
    if (nextValue) {
      suppressClickRef.current = true;
      onChange(nextValue);
    }
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? (locale === "ja" ? "返却タグ" : "Return tag")}
      onPointerDown={(event) => {
        if (!enableSwipe) return;
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => handlePointerUp(event.clientX, event.clientY)}
      onPointerCancel={() => { pointerStart.current = null; }}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        /* context は 320px でも 3 連が文字切れしない密度にする */
        gap: isContext ? 4 : compact ? 4 : 6,
        ...(isContext ? { height: "var(--ops-context, 38px)" } : {}),
        touchAction: enableSwipe ? "pan-y" : "auto",
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        const style = TAG_STYLES[option.value];
        const Icon = style.icon;

        return (
          <button
            key={option.value}
            type="button"
            onClick={(event) => {
              if (suppressClickRef.current) {
                event.preventDefault();
                event.stopPropagation();
                suppressClickRef.current = false;
                return;
              }
              selectValue(option.value);
            }}
            aria-pressed={active}
            style={isContext
              ? {
                  minWidth: 0,
                  height: "100%",
                  padding: "0 5px",
                  borderRadius: 11,
                  border: "none",
                  background: active ? style.background : "var(--ops-context-fill, #fff)",
                  boxShadow: active
                    ? `inset 0 0 0 1.5px ${style.border}`
                    : "inset 0 0 0 1px rgba(15,23,42,0.11)",
                  color: active ? style.color : "#94a3b8",
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  /*
                    狭い幅ではアイコンを上に逃がし、ラベルへ行幅を全部渡す。
                    向きは親の CSS（media query）が決める。
                  */
                  flexDirection: "var(--ops-tag-dir, row)" as CSSProperties["flexDirection"],
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--ops-tag-gap, 4px)",
                  transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
                  WebkitTapHighlightColor: "transparent",
                }
              : {
                  minWidth: 0,
                  padding: compact ? "6px 8px" : "10px 8px",
                  borderRadius: compact ? 8 : 12,
                  border: `${active ? 2 : 1.5}px solid ${active ? style.border : "#e2e8f0"}`,
                  background: active ? style.background : "#fff",
                  color: active ? style.color : "#94a3b8",
                  fontSize: compact ? 11 : 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: stackedLabels ? "column" : "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: stackedLabels ? 2 : 5,
                  transition: "background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s",
                  boxShadow: active ? `0 2px 8px ${style.color}20` : "none",
                }}
          >
            <Icon size={isContext ? 12 : compact ? 13 : 14} style={{ flexShrink: 0 }} />
            <span style={stackedLabels && !isContext
              ? { minWidth: 0, lineHeight: 1.1, textAlign: "center", whiteSpace: "normal", overflowWrap: "anywhere" }
              : { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getReturnTagLabel(option.value, locale)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
