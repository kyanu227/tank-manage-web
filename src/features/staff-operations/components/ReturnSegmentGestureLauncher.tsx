"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

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
  onSelectManualReturn?: () => void;
}

const LONG_PRESS_MS = 300;
const MOVE_TOLERANCE_PX = 12;
const SLOT_HEIGHT_PX = 48;
const MANUAL_OVERSWIPE_PX = -110;
const selectionSuppressionStyle: CSSProperties = {
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
};

const MENU_ITEMS: Array<{
  key: ReturnSegmentKey;
  label: string;
  offsetY: number;
}> = [
  { key: "normal", label: "通常", offsetY: -SLOT_HEIGHT_PX },
  { key: "customer_requests", label: "タグ待ち", offsetY: 0 },
  { key: "long_term", label: "長期", offsetY: SLOT_HEIGHT_PX },
];

function resolveSegmentFromDrag(dy: number): ReturnSegmentKey {
  if (dy < -SLOT_HEIGHT_PX * 0.55) return "normal";
  if (dy > SLOT_HEIGHT_PX * 0.55) return "long_term";
  return "customer_requests";
}

export default function ReturnSegmentGestureLauncher({
  activeSegment,
  segments,
  onSelectSegment,
  onSelectManualReturn,
}: ReturnSegmentGestureLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<ReturnSegmentKey | null>(null);
  const [manualHinted, setManualHinted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    anchorY: number;
    timer: number | null;
    opened: boolean;
    movedAfterOpen: boolean;
    manualHinted: boolean;
  } | null>(null);
  const motionTransition = reducedMotion
    ? "none"
    : "transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 120ms, box-shadow 140ms, border-color 120ms, background 120ms";

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
    setManualHinted(false);
    clearGesture();
  }, [clearGesture]);

  const openMenu = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.opened) return;
    gesture.opened = true;
    gesture.timer = null;
    setIsOpen(true);
    setHoveredKey(null);
    setManualHinted(false);
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
      anchorY: event.clientY,
      timer,
      opened: false,
      movedAfterOpen: false,
      manualHinted: false,
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
    gesture.movedAfterOpen = true;
    const dy = event.clientY - gesture.anchorY;
    const nextManualHinted = dy < MANUAL_OVERSWIPE_PX;
    gesture.manualHinted = nextManualHinted;
    setManualHinted(nextManualHinted);
    setHoveredKey(nextManualHinted ? null : resolveSegmentFromDrag(dy));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.opened) {
      event.preventDefault();
      if (gesture.movedAfterOpen && gesture.manualHinted) {
        onSelectManualReturn?.();
      } else if (gesture.movedAfterOpen && hoveredKey) {
        onSelectSegment(hoveredKey);
      }
    }
    closeMenu();
  };

  const handlePointerCancel = () => {
    closeMenu();
  };

  useEffect(() => clearGesture, [clearGesture]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const preventSelection = (event: Event) => event.preventDefault();
    node.addEventListener("selectstart", preventSelection);
    node.addEventListener("dragstart", preventSelection);
    return () => {
      node.removeEventListener("selectstart", preventSelection);
      node.removeEventListener("dragstart", preventSelection);
    };
  }, []);

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
        ...selectionSuppressionStyle,
        position: "fixed",
        right: 0,
        top: "48%",
        zIndex: 30,
        width: 36,
        height: 168,
        touchAction: "pan-y",
      }}
    >
      {isOpen && (
        <div
          style={{
            ...selectionSuppressionStyle,
            position: "fixed",
            inset: 0,
            zIndex: 0,
            background: "transparent",
            pointerEvents: "auto",
            touchAction: "none",
          }}
        />
      )}

      {isOpen && (
        <div
          style={{
            ...selectionSuppressionStyle,
            position: "absolute",
            right: 20,
            top: 84,
            zIndex: 2,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        >
          {MENU_ITEMS.map((item) => {
            const segment = segments.find((candidate) => candidate.key === item.key);
            const isHovered = hoveredKey === item.key;
            const isActive = activeSegment === item.key;
            const color = segment?.color ?? "#64748b";
            const background = segment?.background ?? "#fff";
            const count = segment?.customerCount ?? 0;

            return (
              <div
                key={item.key}
                style={{
                  ...selectionSuppressionStyle,
                  position: "absolute",
                  right: 20,
                  top: item.offsetY - 18,
                  minWidth: 82,
                  padding: "8px 10px",
                  borderRadius: 999,
                  border: `1.5px solid ${isHovered || isActive ? color : "#e2e8f0"}`,
                  background: isHovered || isActive ? background : "#fff",
                  color: isHovered || isActive ? color : "#475569",
                  fontSize: 12,
                  fontWeight: 900,
                  boxShadow: isHovered ? `0 10px 22px ${color}33` : "0 5px 14px rgba(15,23,42,0.12)",
                  opacity: isHovered ? 1 : isActive ? 0.92 : 0.64,
                  whiteSpace: "nowrap",
                  transform: isHovered
                    ? "translateX(-8px) scale(1.06)"
                    : isActive
                      ? "translateX(-3px) scale(0.98)"
                      : "translateX(0) scale(0.9)",
                  transition: motionTransition,
                }}
              >
                {item.label} {count}
              </div>
            );
          })}

          <div
            style={{
              ...selectionSuppressionStyle,
              position: "absolute",
              right: 28,
              top: -104,
              minWidth: 96,
              padding: "8px 10px",
              borderRadius: 999,
              border: `1.5px solid ${manualHinted ? "#64748b" : "#e2e8f0"}`,
              background: manualHinted ? "#f1f5f9" : "#f8fafc",
              color: manualHinted ? "#475569" : "#94a3b8",
              fontSize: 11,
              fontWeight: 900,
              opacity: manualHinted ? 0.92 : 0.72,
              whiteSpace: "nowrap",
              boxShadow: manualHinted ? "0 10px 22px rgba(100,116,139,0.22)" : "0 5px 14px rgba(15,23,42,0.10)",
              transform: manualHinted ? "translateX(-4px) scale(0.94)" : "scale(0.88)",
              transition: motionTransition,
            }}
          >
            手動
          </div>
        </div>
      )}

      <div
        style={{
          ...selectionSuppressionStyle,
          position: "absolute",
          right: 0,
          top: 45,
          zIndex: 3,
          width: 16,
          padding: "7px 4px",
          borderRadius: 12,
          border: isOpen ? "1px solid rgba(148, 163, 184, 0.40)" : "1px solid rgba(148, 163, 184, 0.18)",
          background: isOpen ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.36)",
          boxShadow: isOpen ? "0 8px 22px rgba(15, 23, 42, 0.15)" : "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 7,
          backdropFilter: "blur(6px)",
          transition: motionTransition,
        }}
      >
        {segments.map((segment) => {
          const isActive = activeSegment === segment.key;
          const isHovered = hoveredKey === segment.key;
          const hasItems = segment.customerCount > 0 || segment.tankCount > 0;
          return (
            <div
              key={segment.key}
              title={`${segment.label}: ${segment.customerCount}顧客 / ${segment.tankCount}本`}
              style={{
                ...selectionSuppressionStyle,
                width: isActive || isHovered ? 8 : hasItems ? 7 : 5,
                height: isActive || isHovered ? 8 : hasItems ? 7 : 5,
                borderRadius: 999,
                border: isActive || isHovered || hasItems ? `2px solid ${segment.color}` : "1px solid rgba(100,116,139,0.34)",
                background: isActive || isHovered || hasItems ? segment.background : "rgba(100,116,139,0.24)",
                opacity: isOpen ? 0.95 : isActive ? 0.85 : hasItems ? 0.7 : 0.32,
                boxShadow: isHovered ? `0 0 0 5px ${segment.color}18` : hasItems ? `0 0 0 3px ${segment.color}10` : "none",
                transform: isHovered ? "scale(1.25)" : isActive ? "scale(1.1)" : "scale(1)",
                transition: motionTransition,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
