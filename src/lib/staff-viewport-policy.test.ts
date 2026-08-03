import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAFF_VIEWPORT_MODE,
  STAFF_LOCKED_VIEWPORT_PATHS,
  resolveStaffViewportMode,
} from "./staff-viewport-policy";

describe("staff viewport policy", () => {
  it("defaults to document scroll", () => {
    expect(DEFAULT_STAFF_VIEWPORT_MODE).toBe("allowed");
    expect(resolveStaffViewportMode(null)).toBe("allowed");
    expect(resolveStaffViewportMode(undefined)).toBe("allowed");
    expect(resolveStaffViewportMode("/staff/unknown")).toBe("allowed");
  });

  it("locks only the ID entry style screens", () => {
    STAFF_LOCKED_VIEWPORT_PATHS.forEach((path) => {
      expect(resolveStaffViewportMode(path), path).toBe("locked");
    });
  });

  it("keeps long list screens scrollable", () => {
    ["/staff/dashboard", "/staff/mypage", "/staff/supply-order", "/staff/tank-purchase", "/staff/tank-register"]
      .forEach((path) => {
        expect(resolveStaffViewportMode(path), path).toBe("allowed");
      });
  });
});
