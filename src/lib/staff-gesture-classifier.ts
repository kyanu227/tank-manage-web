export const STAFF_SECTION_SWIPE_AXIS_LOCK_THRESHOLD_PX = 10;
export const STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX = 40;

export type StaffGestureAxis = "undecided" | "x" | "y";
export type StaffGestureCommit = "section" | "menu-open" | "menu-close" | null;

/**
 * 最初に優勢になった軸へ固定し、gesture が終わるまで変更しない。
 */
export function lockStaffGestureAxis(
  axis: StaffGestureAxis,
  dx: number,
  dy: number,
): StaffGestureAxis {
  if (axis !== "undecided") return axis;

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (
    absDx < STAFF_SECTION_SWIPE_AXIS_LOCK_THRESHOLD_PX
    && absDy < STAFF_SECTION_SWIPE_AXIS_LOCK_THRESHOLD_PX
  ) {
    return "undecided";
  }

  return absDx > absDy ? "x" : "y";
}

/**
 * lock 済みの軸と最終移動量だけから、commit する操作を一意に決める。
 */
export function classifyStaffGestureCommit(
  axis: StaffGestureAxis,
  dx: number,
  dy: number,
): StaffGestureCommit {
  if (axis === "x" && Math.abs(dx) >= STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX) {
    return "section";
  }
  if (axis === "y" && dy >= STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX) {
    return "menu-open";
  }
  if (axis === "y" && -dy >= STAFF_SECTION_SWIPE_COMMIT_DISTANCE_PX) {
    return "menu-close";
  }
  return null;
}
