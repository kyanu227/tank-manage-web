"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  PROCUREMENT_MODES,
  PROCUREMENT_ROUTE_BY_MODE,
  type ProcurementMode,
} from "@/features/procurement/constants";
import {
  STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX,
  dispatchStaffSectionSwipeEnd,
  dispatchStaffSectionSwipeProgress,
  shouldIgnoreSwipeStart,
} from "@/components/staff-section-tabs-events";

export function useProcurementSwipe(mode: ProcurementMode) {
  const router = useRouter();
  const swipeRef = useRef<{
    startX: number;
    startY: number;
    horizontalSwipeStarted: boolean;
  } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || shouldIgnoreSwipeStart(e.target, touch.clientX)) {
        swipeRef.current = null;
        return;
      }

      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        horizontalSwipeStarted: false,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      const swipe = swipeRef.current;
      const touch = e.touches[0];
      if (!swipe || !touch) return;

      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      if (!swipe.horizontalSwipeStarted) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) <= Math.abs(dy)) return;
        swipe.horizontalSwipeStarted = true;
      }

      const idx = PROCUREMENT_MODES.indexOf(mode);
      const offsetTabs = Math.max(-1, Math.min(1, -dx / (window.innerWidth / PROCUREMENT_MODES.length)));
      dispatchStaffSectionSwipeProgress({
        key: "procurement",
        baseIndex: idx,
        offsetTabs,
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!swipeRef.current) return;
      const swipe = swipeRef.current;
      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      swipeRef.current = null;

      if (!swipe.horizontalSwipeStarted || Math.abs(dx) < STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX || Math.abs(dx) < Math.abs(dy)) {
        dispatchStaffSectionSwipeEnd({ key: "procurement", committed: false });
        return;
      }

      const idx = PROCUREMENT_MODES.indexOf(mode);
      const nextMode = dx < 0
        ? PROCUREMENT_MODES[(idx + 1) % PROCUREMENT_MODES.length]
        : PROCUREMENT_MODES[(idx - 1 + PROCUREMENT_MODES.length) % PROCUREMENT_MODES.length];

      dispatchStaffSectionSwipeEnd({
        key: "procurement",
        committed: true,
        settledIndex: PROCUREMENT_MODES.indexOf(nextMode),
      });
      router.replace(PROCUREMENT_ROUTE_BY_MODE[nextMode]);
    };

    const onTouchCancel = () => {
      if (!swipeRef.current?.horizontalSwipeStarted) {
        swipeRef.current = null;
        return;
      }
      swipeRef.current = null;
      dispatchStaffSectionSwipeEnd({ key: "procurement", committed: false });
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [mode, router]);
}
