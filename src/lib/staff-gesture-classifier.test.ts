import { describe, expect, it } from "vitest";
import {
  classifyStaffGestureCommit,
  lockStaffGestureAxis,
  type StaffGestureAxis,
} from "./staff-gesture-classifier";

describe("staff gesture classifier", () => {
  it("9px 以下では axis を確定しない", () => {
    expect(lockStaffGestureAxis("undecided", 9, 9)).toBe("undecided");
    expect(lockStaffGestureAxis("undecided", -9, -9)).toBe("undecided");
  });

  it("x 優勢なら x、y 優勢または同値なら y に lock する", () => {
    expect(lockStaffGestureAxis("undecided", 11, 10)).toBe("x");
    expect(lockStaffGestureAxis("undecided", 10, 11)).toBe("y");
    expect(lockStaffGestureAxis("undecided", 10, 10)).toBe("y");
  });

  it.each([
    ["x", 5, 50, "x"],
    ["y", 50, 5, "y"],
  ] as const)("%s lock 後は移動方向が変わっても axis を変えない", (axis, dx, dy, expected) => {
    expect(lockStaffGestureAxis(axis, dx, dy)).toBe(expected);
  });

  it.each([
    ["x", 39, 0, null],
    ["x", 40, 0, "section"],
    ["y", 0, 39, null],
    ["y", 0, 40, "menu-open"],
    ["y", 0, -40, "menu-close"],
  ] as const)("axis=%s dx=%d dy=%d の commit は %s", (axis, dx, dy, expected) => {
    expect(classifyStaffGestureCommit(axis, dx, dy)).toBe(expected);
  });

  it("斜め gesture でも lock した単一操作だけを返す", () => {
    const xAxis: StaffGestureAxis = lockStaffGestureAxis("undecided", 11, 10);
    const yAxis: StaffGestureAxis = lockStaffGestureAxis("undecided", 10, 10);

    expect(classifyStaffGestureCommit(xAxis, 40, 80)).toBe("section");
    expect(classifyStaffGestureCommit(yAxis, 80, 40)).toBe("menu-open");
  });
});
