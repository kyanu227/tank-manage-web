import { describe, expect, it } from "vitest";
import {
  ALL_ADMIN_CAPABILITIES,
  getAdminCapabilitiesForRole,
} from "@/lib/admin/adminCapabilities";

describe("admin capabilities", () => {
  it("管理者は全capabilityを取得する", () => {
    expect(getAdminCapabilitiesForRole("管理者", {})).toEqual(ALL_ADMIN_CAPABILITIES);
  });

  it("準管理者は明示許可されたcapabilityだけを取得する", () => {
    expect(getAdminCapabilitiesForRole("準管理者", {
      "dashboard.view": ["管理者", "準管理者"],
      "reviews.approve": ["管理者"],
    })).toEqual(["dashboard.view"]);
  });

  it("一般スタッフはAdmin capabilityを取得しない", () => {
    expect(getAdminCapabilitiesForRole("一般", {
      "dashboard.view": ["準管理者"],
    })).toEqual([]);
  });
});
