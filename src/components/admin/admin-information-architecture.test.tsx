import { describe, expect, it } from "vitest";
import { getVisibleAdminStaffTabs } from "@/components/admin/AdminStaffTabs";
import { resolveAdminLauncherLinks } from "@/components/admin/AdminSettingsLauncher";
import { getAdminReviewBadgeLabel } from "@/components/admin/AdminSidebarContent";
import {
  ADMIN_CUSTOMER_TABS,
  getVisibleAdminSectionTabs,
} from "@/lib/admin/adminSectionTabs";

describe("Admin information architecture", () => {
  it("取引先tabをcapabilityで絞り、一つだけの場合も安全な遷移先を残す", () => {
    expect(getVisibleAdminSectionTabs(ADMIN_CUSTOMER_TABS, ["customers.view"]).map((tab) => tab.id))
      .toEqual(["customers"]);
    expect(getVisibleAdminSectionTabs(ADMIN_CUSTOMER_TABS, ["customerPortalUsers.view"]).map((tab) => tab.id))
      .toEqual(["portalUsers"]);
    expect(getVisibleAdminSectionTabs(ADMIN_CUSTOMER_TABS, [])).toEqual([]);
  });

  it("スタッフtabを担当者・権限・報酬の順でcapability filterする", () => {
    expect(getVisibleAdminStaffTabs([
      "staffCompensation.view",
      "staff.view",
      "staffPermissions.view",
    ]).map((tab) => tab.id)).toEqual(["members", "permissions", "compensation"]);
    expect(getVisibleAdminStaffTabs(["staff.view"]).map((tab) => tab.id)).toEqual(["members"]);
    expect(getVisibleAdminStaffTabs([])).toEqual([]);
  });

  it("準管理者には開発者ツールを出さない", () => {
    expect(resolveAdminLauncherLinks([
      "settings.businessRules.view",
      "developer.stateDiagram.view",
    ], "準管理者")).toEqual({
      settingsHref: "/admin/settings",
      developerHref: null,
    });
    expect(resolveAdminLauncherLinks(["developer.stateDiagram.view"], "管理者").developerHref)
      .toBe("/admin/state-diagram");
  });

  it("レビューバッジは展開時に上限付き数値、縮小時にdot用空labelを返す", () => {
    expect(getAdminReviewBadgeLabel(8, false)).toBe("8");
    expect(getAdminReviewBadgeLabel(120, false)).toBe("99+");
    expect(getAdminReviewBadgeLabel(8, true)).toBe("");
  });
});
