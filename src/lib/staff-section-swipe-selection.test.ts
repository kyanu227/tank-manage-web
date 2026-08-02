import { describe, expect, it } from "vitest";
import { MODES } from "@/features/staff-operations/constants";
import { MAINTENANCE_MODES } from "@/features/maintenance/constants";
import { PROCUREMENT_MODES } from "@/features/procurement/constants";
import {
  reconcileStaffSectionSwipePendingTarget,
  resolveStaffSectionSwipeBase,
  selectNextStaffSectionSwipeMode,
  type StaffSectionSwipeDirection,
} from "./staff-section-swipe-selection";

function advance<Mode extends string>(
  modes: readonly Mode[],
  renderedMode: Mode,
  directions: readonly StaffSectionSwipeDirection[],
): Mode {
  let pendingTarget: Mode | null = null;

  for (const direction of directions) {
    pendingTarget = selectNextStaffSectionSwipeMode(
      modes,
      renderedMode,
      pendingTarget,
      direction,
    ).nextMode;
  }

  return pendingTarget ?? renderedMode;
}

describe("staff section swipe selection", () => {
  it("基準 mode から left / right で隣へ進む", () => {
    expect(selectNextStaffSectionSwipeMode(MODES, "return", null, "left")).toMatchObject({
      baseMode: "return",
      baseIndex: 1,
      nextMode: "fill",
      settledIndex: 2,
    });
    expect(selectNextStaffSectionSwipeMode(MODES, "return", null, "right")).toMatchObject({
      baseMode: "return",
      baseIndex: 1,
      nextMode: "lend",
      settledIndex: 0,
    });
  });

  it("両方向とも端で循環する", () => {
    expect(selectNextStaffSectionSwipeMode(MODES, "fill", null, "left").nextMode).toBe("lend");
    expect(selectNextStaffSectionSwipeMode(MODES, "lend", null, "right").nextMode).toBe("fill");
  });

  it("pending target がある間は pending を基準にする", () => {
    expect(resolveStaffSectionSwipeBase(MODES, "lend", "return")).toEqual({
      mode: "return",
      index: 1,
    });
    expect(selectNextStaffSectionSwipeMode(MODES, "lend", "return", "left")).toMatchObject({
      baseMode: "return",
      baseIndex: 1,
      nextMode: "fill",
      settledIndex: 2,
    });
  });

  it("rendered mode が pending target に追いついたら pending を解除する", () => {
    expect(reconcileStaffSectionSwipePendingTarget("return", "return")).toBeNull();
    expect(reconcileStaffSectionSwipePendingTarget("lend", "return")).toBe("return");
    expect(reconcileStaffSectionSwipePendingTarget("return", null)).toBeNull();
  });

  it("同方向2回で2つ先へ進む", () => {
    expect(advance(MODES, "lend", ["left", "left"])).toBe("fill");
  });

  it("同方向3回で循環して3つ先へ進む", () => {
    expect(advance(MODES, "lend", ["left", "left", "left"])).toBe("lend");
  });

  it("逆方向を混ぜても pending target から決定的に選択する", () => {
    expect(advance(MODES, "lend", ["left", "left", "right"])).toBe("return");
    expect(advance(MODES, "lend", ["right", "left", "right"])).toBe("fill");
  });

  describe.each([
    ["operations", MODES],
    ["maintenance", MAINTENANCE_MODES],
    ["procurement", PROCUREMENT_MODES],
  ] as const)("%s modes", (_name, modes) => {
    it("連続入力・循環・逆方向の共通 invariant を満たす", () => {
      expect(advance(modes, modes[0], ["left"])).toBe(modes[1]);
      expect(advance(modes, modes[0], ["left", "left"])).toBe(modes[2]);
      expect(advance(modes, modes[0], ["left", "left", "left"])).toBe(modes[0]);
      expect(advance(modes, modes[0], ["right"])).toBe(modes[2]);
      expect(advance(modes, modes[0], ["left", "right"])).toBe(modes[0]);
    });
  });
});
