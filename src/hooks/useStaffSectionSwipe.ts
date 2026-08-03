"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  dispatchStaffSectionSwipeEnd,
  dispatchStaffSectionSwipeProgress,
  isStaffSectionSwipeEdgeGuarded,
  resolveStaffSwipeStartTarget,
  shouldIgnoreStaffSectionSwipeStart,
  suppressNextStaffSwipeClick,
} from "@/components/staff-section-tabs-events";
import {
  classifyStaffGestureCommit,
  lockStaffGestureAxis,
  type StaffGestureAxis,
} from "@/lib/staff-gesture-classifier";
import {
  reconcileStaffSectionSwipePendingTarget,
  resolveStaffSectionSwipeBase,
  selectNextStaffSectionSwipeMode,
} from "@/lib/staff-section-swipe-selection";

export interface StaffSectionSwipeConfig<Mode extends string> {
  readonly key: string;
  readonly modes: readonly Mode[];
  readonly resolveHref: (mode: Mode) => string;
}

interface StaffSectionSwipeGesture {
  readonly startX: number;
  readonly startY: number;
  readonly clickTarget: Element | null;
  axis: StaffGestureAxis;
}

/** operations / maintenance / procurement が共有する section swipe。 */
export function useStaffSectionSwipe<Mode extends string>(
  mode: Mode,
  config: StaffSectionSwipeConfig<Mode>,
) {
  const router = useRouter();
  const currentModeRef = useRef(mode);
  const configRef = useRef(config);
  const pendingTargetRef = useRef<Mode | null>(null);
  const swipeRef = useRef<StaffSectionSwipeGesture | null>(null);

  useLayoutEffect(() => {
    currentModeRef.current = mode;
    configRef.current = config;
    pendingTargetRef.current = reconcileStaffSectionSwipePendingTarget(
      mode,
      pendingTargetRef.current,
    );
  }, [config, mode]);

  useEffect(() => {
    const cancelHorizontalSwipe = () => {
      if (swipeRef.current?.axis === "x") {
        dispatchStaffSectionSwipeEnd({
          key: configRef.current.key,
          committed: false,
        });
      }
      swipeRef.current = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || shouldIgnoreStaffSectionSwipeStart(event.target)) {
        swipeRef.current = null;
        return;
      }

      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        axis: "undecided",
        clickTarget: resolveStaffSwipeStartTarget(event.target)?.clickTarget ?? null,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const swipe = swipeRef.current;
      const touch = event.touches[0];
      if (!swipe || !touch) return;

      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      swipe.axis = lockStaffGestureAxis(swipe.axis, dx, dy);
      if (swipe.axis !== "x") return;

      if (isStaffSectionSwipeEdgeGuarded(swipe.startX)) {
        swipeRef.current = null;
        return;
      }

      const { key, modes } = configRef.current;
      const { index } = resolveStaffSectionSwipeBase(
        modes,
        currentModeRef.current,
        pendingTargetRef.current,
      );
      const offsetTabs = Math.max(
        -1,
        Math.min(1, -dx / (window.innerWidth / modes.length)),
      );
      dispatchStaffSectionSwipeProgress({
        key,
        baseIndex: index,
        offsetTabs,
      });
    };

    const onTouchEnd = (event: TouchEvent) => {
      const swipe = swipeRef.current;
      if (!swipe) return;

      const touch = event.changedTouches[0];
      if (!touch) {
        cancelHorizontalSwipe();
        return;
      }

      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      swipe.axis = lockStaffGestureAxis(swipe.axis, dx, dy);

      if (swipe.axis === "x" && isStaffSectionSwipeEdgeGuarded(swipe.startX)) {
        swipeRef.current = null;
        return;
      }

      const commit = classifyStaffGestureCommit(swipe.axis, dx, dy);
      swipeRef.current = null;
      if (commit !== "section") {
        if (swipe.axis === "x") {
          dispatchStaffSectionSwipeEnd({
            key: configRef.current.key,
            committed: false,
          });
        }
        return;
      }

      if (swipe.clickTarget) suppressNextStaffSwipeClick();

      const { key, modes, resolveHref } = configRef.current;
      const selection = selectNextStaffSectionSwipeMode(
        modes,
        currentModeRef.current,
        pendingTargetRef.current,
        dx < 0 ? "left" : "right",
      );
      pendingTargetRef.current = selection.nextMode;

      dispatchStaffSectionSwipeEnd({
        key,
        committed: true,
        settledIndex: selection.settledIndex,
      });
      router.replace(resolveHref(selection.nextMode));
    };

    const onTouchCancel = () => cancelHorizontalSwipe();

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      cancelHorizontalSwipe();
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [router]);
}
