"use client";

import {
  STAFF_SECTION_SWIPE_AXIS_LOCK_THRESHOLD_PX,
  STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX,
} from "@/lib/staff-gesture-classifier";

export {
  STAFF_SECTION_SWIPE_AXIS_LOCK_THRESHOLD_PX,
  STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX,
};

export const STAFF_SECTION_SWIPE_PROGRESS_EVENT = "staff-section-swipe-progress";
export const STAFF_SECTION_SWIPE_END_EVENT = "staff-section-swipe-end";
export const STAFF_SECTION_SWIPE_IGNORE_SELECTOR =
  '[data-swipe-ignore="true"], [data-drum-roll-option="true"], select, input, textarea, [role="listbox"]';
export const STAFF_SECTION_SWIPE_EDGE_GUARD_PX = 80;
export const STAFF_SWIPE_SURFACE_SELECTOR = "[data-staff-swipe-surface]";

export type StaffSwipeSurface =
  | "header"
  | "tabs"
  | "confirm"
  | "menu-backdrop"
  | "menu";

export interface StaffSwipeStartTarget {
  readonly surface: StaffSwipeSurface;
  readonly surfaceElement: Element;
  readonly clickTarget: Element | null;
}

export interface StaffSectionSwipeProgressDetail {
  key: string;
  baseIndex: number;
  offsetTabs: number;
}

export interface StaffSectionSwipeEndDetail {
  key: string;
  committed: boolean;
  settledIndex?: number;
}

export function isSwipeIgnoredTarget(target: EventTarget | null) {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest(STAFF_SECTION_SWIPE_IGNORE_SELECTOR));
}

function isStaffSwipeSurface(value: string | null): value is StaffSwipeSurface {
  return value === "header"
    || value === "tabs"
    || value === "confirm"
    || value === "menu-backdrop"
    || value === "menu";
}

/**
 * start target は ignore → 明示 surface の順で解決する。
 * 通常の a / button は surface 内なら許可し、commit 後の click だけを抑止する。
 */
export function resolveStaffSwipeStartTarget(
  target: EventTarget | null,
): StaffSwipeStartTarget | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  if (isSwipeIgnoredTarget(target)) return null;

  const surfaceElement = target.closest(STAFF_SWIPE_SURFACE_SELECTOR);
  const surface = surfaceElement?.getAttribute("data-staff-swipe-surface") ?? null;
  if (!surfaceElement || !isStaffSwipeSurface(surface)) return null;

  return {
    surface,
    surfaceElement,
    clickTarget: target.closest("a, button:not([disabled])"),
  };
}

/** menu の面では背後にある section swipe を開始しない。 */
export function shouldIgnoreStaffSectionSwipeStart(target: EventTarget | null) {
  if (isSwipeIgnoredTarget(target)) return true;
  const resolved = resolveStaffSwipeStartTarget(target);
  return resolved?.surface === "menu" || resolved?.surface === "menu-backdrop";
}

/** 右端 guard は x 軸へ lock した後にだけ呼ぶ。 */
export function isStaffSectionSwipeEdgeGuarded(
  startX: number,
  edgeGuardPx = STAFF_SECTION_SWIPE_EDGE_GUARD_PX,
) {
  if (typeof window === "undefined") return false;
  return startX > window.innerWidth - edgeGuardPx;
}

export function canScrollStaffMenuForward(element: HTMLElement | null) {
  if (!element) return false;
  return element.scrollTop < element.scrollHeight - element.clientHeight;
}

/**
 * touchend 直後に生成される click を capture phase で1回だけ抑止する。
 * timeout は click が生成されなかった場合の後始末にだけ使う。
 */
export function suppressNextStaffSwipeClick(cleanupDelayMs = 500) {
  if (typeof document === "undefined") return;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const remove = () => {
    document.removeEventListener("click", handleClick, true);
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    remove();
  };

  document.addEventListener("click", handleClick, { capture: true, once: true });
  timeoutId = setTimeout(remove, cleanupDelayMs);
}

export function dispatchStaffSectionSwipeProgress(detail: StaffSectionSwipeProgressDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StaffSectionSwipeProgressDetail>(STAFF_SECTION_SWIPE_PROGRESS_EVENT, { detail }));
}

export function dispatchStaffSectionSwipeEnd(detail: StaffSectionSwipeEndDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StaffSectionSwipeEndDetail>(STAFF_SECTION_SWIPE_END_EVENT, { detail }));
}
