"use client";

export const STAFF_SECTION_SWIPE_PROGRESS_EVENT = "staff-section-swipe-progress";
export const STAFF_SECTION_SWIPE_END_EVENT = "staff-section-swipe-end";
export const STAFF_SECTION_SWIPE_IGNORE_SELECTOR =
  '[data-swipe-ignore="true"], [data-drum-roll-option="true"]';
export const STAFF_SECTION_SWIPE_EDGE_GUARD_PX = 80;
export const STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX = 40;

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

export function shouldIgnoreSwipeStart(
  target: EventTarget | null,
  startX: number,
  edgeGuardPx = STAFF_SECTION_SWIPE_EDGE_GUARD_PX
) {
  if (isSwipeIgnoredTarget(target)) return true;
  if (typeof window === "undefined") return false;
  return startX > window.innerWidth - edgeGuardPx;
}

export function dispatchStaffSectionSwipeProgress(detail: StaffSectionSwipeProgressDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StaffSectionSwipeProgressDetail>(STAFF_SECTION_SWIPE_PROGRESS_EVENT, { detail }));
}

export function dispatchStaffSectionSwipeEnd(detail: StaffSectionSwipeEndDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StaffSectionSwipeEndDetail>(STAFF_SECTION_SWIPE_END_EVENT, { detail }));
}
