"use client";

import { AlertCircle, Clock, Droplets, type LucideIcon } from "lucide-react";
import { useRef } from "react";

export type ReturnTagValue = "normal" | "unused" | "uncharged" | "keep";

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

export function getReturnTagLabel(value: ReturnTagValue): string {
  if (value === "normal") return "通常";
  if (value === "unused") return "未使用";
  if (value === "uncharged") return "未充填";
  return "持ち越し";
}

export default function ReturnTagSelector<T extends ReturnTagValue = ReturnTagValue>({
  value,
  onChange,
  options,
  enableSwipe = false,
  swipeLeftValue,
  swipeRightValue,
  compact = false,
}: ReturnTagSelectorProps<T>) {
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
      onPointerDown={(event) => {
        if (!enableSwipe) return;
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => handlePointerUp(event.clientX, event.clientY)}
      onPointerCancel={() => { pointerStart.current = null; }}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: compact ? 4 : 6,
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
            style={{
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
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              transition: "background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s",
              boxShadow: active ? `0 2px 8px ${style.color}20` : "none",
            }}
          >
            <Icon size={compact ? 13 : 14} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
