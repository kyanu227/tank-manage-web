import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGES,
  findAdminPage,
  getFirstAccessibleAdminHref,
  getResolvedAdminPageHref,
  getVisibleAdminSidebarGroups,
  getVisibleAdminSidebarPages,
  isAdminSidebarPageActive,
  matchesAdminPagePath,
} from "@/lib/admin/adminPagesRegistry";
import { ALL_ADMIN_CAPABILITIES } from "@/lib/admin/adminCapabilities";

describe("admin page registry", () => {
  it("重複idと重複routeを持たない", () => {
    expect(new Set(ADMIN_PAGES.map((page) => page.id)).size).toBe(ADMIN_PAGES.length);
    expect(new Set(ADMIN_PAGES.map((page) => page.href)).size).toBe(ADMIN_PAGES.length);
  });

  it("dashboardはexact、子routeはprefixでactive判定する", () => {
    const dashboard = ADMIN_PAGES.find((page) => page.id === "dashboard")!;
    const customers = ADMIN_PAGES.find((page) => page.id === "customers")!;

    expect(matchesAdminPagePath(dashboard, "/admin")).toBe(true);
    expect(matchesAdminPagePath(dashboard, "/admin/sales")).toBe(false);
    expect(matchesAdminPagePath(customers, "/admin/customers/users")).toBe(true);
    expect(findAdminPage("/admin/customers/users")?.id).toBe("customer-portal-users");
  });

  it("sidebar項目をcapabilityでfilterする", () => {
    const pages = getVisibleAdminSidebarPages([
      "dashboard.view",
      "analytics.sales.view",
    ]);

    expect(pages.map((page) => page.id)).toEqual(["dashboard", "sales"]);
  });

  it("確定した目的別順序とgroupを返す", () => {
    const groups = getVisibleAdminSidebarGroups(ALL_ADMIN_CAPABILITIES);
    const pages = groups.flatMap((group) => group.items);
    expect(pages.map((page) => page.id)).toEqual([
      "dashboard",
      "reviews",
      "billing",
      "sales",
      "staff-analytics",
      "customers",
      "staff",
      "order-master",
    ]);
    expect(pages.map((page) => page.group)).toEqual([
      "dashboard",
      "response",
      "response",
      "analysis",
      "analysis",
      "management",
      "management",
      "management",
    ]);
    expect(groups.map((group) => group.label)).toEqual(["", "対応", "分析", "管理"]);
  });

  it("統合項目は利用可能な関連tabへ遷移し、関連routeでもactiveになる", () => {
    const customers = ADMIN_PAGES.find((page) => page.id === "customers")!;
    const staff = ADMIN_PAGES.find((page) => page.id === "staff")!;

    expect(getVisibleAdminSidebarPages(["customerPortalUsers.view"]).map((page) => page.id))
      .toEqual(["customers"]);
    expect(getResolvedAdminPageHref(customers, ["customerPortalUsers.view"]))
      .toBe("/admin/customers/users");
    expect(getResolvedAdminPageHref(staff, ["staffCompensation.view"]))
      .toBe("/admin/money");
    expect(isAdminSidebarPageActive(staff, "/admin/permissions")).toBe(true);
    expect(isAdminSidebarPageActive(staff, "/admin/money")).toBe(true);
  });

  it("capabilityが無い場合は安全な遷移先を返さない", () => {
    expect(getFirstAccessibleAdminHref([])).toBeNull();
  });
});
