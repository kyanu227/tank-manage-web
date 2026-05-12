"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { CircleDotDashed } from "lucide-react";

export type ReturnSegmentKey = "customer_requests" | "long_term" | "normal";

export interface ReturnSegmentStat {
  key: ReturnSegmentKey;
  label: string;
  shortLabel: string;
  customerCount: number;
  tankCount: number;
  taggedCount: number;
  color: string;
  background: string;
}

interface ReturnSegmentGestureLauncherProps {
  activeSegment: ReturnSegmentKey | null;
  segments: ReturnSegmentStat[];
  onSelectSegment: (segment: ReturnSegmentKey) => void;
}

type MenuKey = ReturnSegmentKey | "manual";

const LONG_PRESS_MS = 300;
const MOVE_TOLERANCE_PX = 12;

const MENU_ITEMS: Array<{
  key: MenuKey;
  label: string;
  disabled?: boolean;
  position: { right: number; top: number };
}> = [
  { key: "customer_requests", label: "顧客申請あり", position: { right: 58, top: -92 } },
  { key: "long_term", label: "長期 / 持ち越し", position: { right: 76, top: -32 } },
  { key: "normal", label: "通常返却", position: { right: 58, top: 28 } },
  { key: "manual", label: "手動 未接続", disabled: true, position: { right: 118, top: -156 } },
];

export default function ReturnSegmentGestureLauncher({
  activeSegment,
  segments,
  onSelectSegment,
}: ReturnSegmentGestureLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<MenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Partial<Record<MenuKey, HTMLButtonElement | null>>>({});
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    timer: number | null;
    opened: boolean;
  } | null>(null);

  const clearGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture?.timer != null) {
      window.clearTimeout(gesture.timer);
    }
    if (gesture && rootRef.current?.hasPointerCapture?.(gesture.pointerId)) {
      rootRef.current.releasePointerCapture(gesture.pointerId);
    }
    gestureRef.current = null;
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setHoveredKey(null);
    clearGesture();
  }, [clearGesture]);

  const findMenuItem = useCallback((clientX: number, clientY: number): MenuKey | null => {
    for (const item of MENU_ITEMS) {
      const node = itemRefs.current[item.key];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return item.key;
      }
    }
    return null;
  }, []);

  const openMenu = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.opened) return;
    gesture.opened = true;
    gesture.timer = null;
    setIsOpen(true);
    rootRef.current?.setPointerCapture?.(gesture.pointerId);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    clearGesture();
    const timer = window.setTimeout(openMenu, LONG_PRESS_MS);
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer,
      opened: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (!gesture.opened) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) > MOVE_TOLERANCE_PX || Math.abs(dy) > MOVE_TOLERANCE_PX) {
        closeMenu();
      }
      return;
    }

    event.preventDefault();
    setHoveredKey(findMenuItem(event.clientX, event.clientY));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    const selectedKey = gesture.opened ? findMenuItem(event.clientX, event.clientY) : null;
    if (selectedKey && selectedKey !== "manual") {
      onSelectSegment(selectedKey);
    }
    closeMenu();
  };

  const handlePointerCancel = () => {
    closeMenu();
  };

  const activeLabel = segments.find((segment) => segment.key === activeSegment)?.shortLabel ?? "全体";

  useEffect(() => clearGesture, [clearGesture]);

  return (
    <div
      ref={rootRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="返却セグメント切替ランチャー"
      style={{
        position: "fixed",
        right: 8,
        top: "48%",
        zIndex: 30,
        width: 74,
        minHeight: 158,
        touchAction: "pan-y",
        userSelect: "none",
      }}
    >
      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 20,
            top: 58,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        >
          {MENU_ITEMS.map((item) => {
            const segment = item.key === "manual"
              ? null
              : segments.find((candidate) => candidate.key === item.key);
            const isHovered = hoveredKey === item.key;
            const isActive = activeSegment === item.key;
            const color = segment?.color ?? "#64748b";
            const background = item.disabled ? "#f8fafc" : segment?.background ?? "#fff";

            return (
              <button
                key={item.key}
                ref={(node) => { itemRefs.current[item.key] = node; }}
                type="button"
                disabled={item.disabled}
                style={{
                  position: "absolute",
                  right: item.position.right,
                  top: item.position.top,
                  minWidth: item.key === "manual" ? 92 : 112,
                  padding: "9px 11px",
                  borderRadius: 999,
                  border: `2px solid ${isHovered || isActive ? color : "#e2e8f0"}`,
                  background: isHovered || isActive ? background : "#fff",
                  color: item.disabled ? "#94a3b8" : "#0f172a",
                  fontSize: 12,
                  fontWeight: 900,
                  boxShadow: isHovered ? `0 8px 18px ${color}33` : "0 4px 12px rgba(15,23,42,0.12)",
                  opacity: item.disabled ? 0.72 : 1,
                  pointerEvents: "auto",
                  whiteSpace: "nowrap",
                  transform: isHovered ? "scale(1.04)" : "scale(1)",
                  transition: "transform 0.12s, border-color 0.12s, box-shadow 0.12s",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: 58,
          padding: "8px 6px",
          borderRadius: 999,
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: "rgba(255,255,255,0.92)",
          boxShadow: "0 8px 22px rgba(15, 23, 42, 0.16)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          backdropFilter: "blur(8px)",
        }}
      >
        <CircleDotDashed size={14} color="#64748b" />
        {segments.map((segment) => {
          const isActive = activeSegment === segment.key;
          return (
            <div
              key={segment.key}
              title={`${segment.label}: ${segment.customerCount}顧客 / ${segment.tankCount}本`}
              style={{
                width: "100%",
                minHeight: 28,
                borderRadius: 999,
                border: `1.5px solid ${isActive ? segment.color : "#e2e8f0"}`,
                background: isActive ? segment.background : "#fff",
                color: isActive ? segment.color : "#64748b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                fontSize: 10,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              <span>{segment.shortLabel}</span>
              <span>{segment.customerCount}</span>
            </div>
          );
        })}
        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 800 }}>{activeLabel}</span>
      </div>
    </div>
  );
}
