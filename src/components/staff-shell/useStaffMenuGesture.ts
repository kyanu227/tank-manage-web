"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  canScrollStaffContentBackward,
  canScrollStaffMenuForward,
  resolveStaffSwipeStartTarget,
  suppressNextStaffSwipeClick,
  STAFF_CONTENT_SWIPE_ZONE_PX,
  type StaffSwipeStartTarget,
} from "@/components/staff-section-tabs-events";
import {
  classifyStaffGestureCommit,
  lockStaffGestureAxis,
  type StaffGestureAxis,
} from "@/lib/staff-gesture-classifier";

interface UseStaffMenuGestureOptions {
  readonly menuOpen: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly scrollRegionRef: React.RefObject<HTMLElement | null>;
}

interface StaffMenuGesture {
  readonly startX: number;
  readonly startY: number;
  readonly target: StaffSwipeStartTarget;
  readonly forwardScrollAvailable: boolean;
  axis: StaffGestureAxis;
}

const MENU_OPEN_SURFACES = new Set(["header", "tabs", "confirm", "content"]);
const MENU_CLOSE_SURFACES = new Set(["menu", "menu-backdrop"]);

/**
 * content surface だけは条件付きで受け付ける。
 *
 * - 起点が viewport 上端の帯の中にあること（本文の途中から開かない）
 * - まだ上へスクロールできる状態では受け付けない（スクロール操作を奪わない）
 * - 通常の a / button 上からは開始しない。本文には操作要素が多く、
 *   header spacer と同じ「非操作領域から払う」感覚に揃える
 */
function acceptsContentStart(
  target: StaffSwipeStartTarget,
  startY: number,
  startTarget: EventTarget | null,
): boolean {
  if (target.clickTarget) return false;
  if (startY > STAFF_CONTENT_SWIPE_ZONE_PX) return false;
  const element = startTarget instanceof Element ? startTarget : null;
  return !canScrollStaffContentBackward(element);
}

/** 明示 surface の縦 gesture と menu open / close を接続する。 */
export function useStaffMenuGesture({
  menuOpen,
  onOpen,
  onClose,
  scrollRegionRef,
}: UseStaffMenuGestureOptions) {
  const menuOpenRef = useRef(menuOpen);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const scrollRegionRefRef = useRef(scrollRegionRef);
  const gestureRef = useRef<StaffMenuGesture | null>(null);

  useLayoutEffect(() => {
    menuOpenRef.current = menuOpen;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
    scrollRegionRefRef.current = scrollRegionRef;
  }, [menuOpen, onClose, onOpen, scrollRegionRef]);

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const target = resolveStaffSwipeStartTarget(event.target);
      if (!touch || !target) {
        gestureRef.current = null;
        return;
      }

      const allowedSurfaces = menuOpenRef.current
        ? MENU_CLOSE_SURFACES
        : MENU_OPEN_SURFACES;
      if (!allowedSurfaces.has(target.surface)) {
        gestureRef.current = null;
        return;
      }

      if (
        target.surface === "content"
        && !acceptsContentStart(target, touch.clientY, event.target)
      ) {
        gestureRef.current = null;
        return;
      }

      const scrollRegion = scrollRegionRefRef.current.current;
      const startedInScrollRegion = Boolean(
        scrollRegion
        && event.target instanceof Element
        && scrollRegion.contains(event.target),
      );

      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        axis: "undecided",
        target,
        forwardScrollAvailable: startedInScrollRegion
          && canScrollStaffMenuForward(scrollRegion),
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch) return;

      gesture.axis = lockStaffGestureAxis(
        gesture.axis,
        touch.clientX - gesture.startX,
        touch.clientY - gesture.startY,
      );
    };

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      const touch = event.changedTouches[0];
      if (!gesture || !touch) return;

      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      gesture.axis = lockStaffGestureAxis(gesture.axis, dx, dy);
      const commit = classifyStaffGestureCommit(gesture.axis, dx, dy);

      if (!menuOpenRef.current && commit === "menu-open") {
        if (gesture.target.clickTarget) suppressNextStaffSwipeClick();
        onOpenRef.current();
        return;
      }

      if (
        menuOpenRef.current
        && commit === "menu-close"
        && !gesture.forwardScrollAvailable
      ) {
        if (gesture.target.clickTarget) suppressNextStaffSwipeClick();
        onCloseRef.current();
      }
    };

    const clearGesture = () => {
      gestureRef.current = null;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", clearGesture, { passive: true });
    return () => {
      clearGesture();
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", clearGesture);
    };
  }, []);
}
