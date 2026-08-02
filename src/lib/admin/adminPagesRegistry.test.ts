import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGES,
  findAdminPage,
  getFirstAccessibleAdminHref,
  getVisibleAdminSidebarPages,
  matchesAdminPagePath,
} from "@/lib/admin/adminPagesRegistry";

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

  it("capabilityが無い場合は安全な遷移先を返さない", () => {
    expect(getFirstAccessibleAdminHref([])).toBeNull();
  });
});
