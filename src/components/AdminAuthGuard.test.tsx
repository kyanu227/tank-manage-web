import { describe, expect, it, vi } from "vitest";
import { decodeAdminPermissions } from "@/lib/admin/admin-permissions";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/sales" }));
vi.mock("@/lib/firebase/config", () => ({ auth: {} }));
vi.mock("@/lib/firebase/staff-auth", () => ({ findActiveStaffByEmail: vi.fn() }));
vi.mock("@/lib/firebase/admin-permissions-service", () => ({ getAdminPermissions: vi.fn() }));

import { resolveAdminPermissionAccess } from "@/components/AdminAuthGuard";

describe("AdminAuthGuard capability resolution", () => {
  it("malformed dataでは準管理者を全拒否する", () => {
    const access = resolveAdminPermissionAccess(
      "準管理者",
      "/admin/sales",
      decodeAdminPermissions({ capabilities: null }),
    );
    expect(access).toEqual({ hasAccess: false, capabilities: [] });
  });

  it("missing documentでは準管理者を全拒否する", () => {
    expect(resolveAdminPermissionAccess(
      "準管理者",
      "/admin/sales",
      { kind: "missing" },
    )).toEqual({ hasAccess: false, capabilities: [] });
  });

  it("許可されたcapabilityで直接URLアクセスを許可する", () => {
    const decoded = decodeAdminPermissions({
      capabilities: { "analytics.sales.view": ["管理者", "準管理者"] },
    });
    const access = resolveAdminPermissionAccess("準管理者", "/admin/sales", decoded);

    expect(access.hasAccess).toBe(true);
    expect(access.capabilities).toEqual(["analytics.sales.view"]);
  });

  it("別capabilityの直接URLアクセスを拒否する", () => {
    const decoded = decodeAdminPermissions({
      capabilities: { "dashboard.view": ["準管理者"] },
    });

    expect(resolveAdminPermissionAccess("準管理者", "/admin/sales", decoded).hasAccess).toBe(false);
  });

  it("設定の直接URLを各view capabilityでのみ許可する", () => {
    const decoded = decodeAdminPermissions({
      capabilities: { "settings.notifications.view": ["準管理者"] },
    });
    expect(resolveAdminPermissionAccess("準管理者", "/admin/notifications", decoded).hasAccess).toBe(true);
    expect(resolveAdminPermissionAccess("準管理者", "/admin/settings", decoded).hasAccess).toBe(false);
    expect(resolveAdminPermissionAccess("準管理者", "/admin/settings/tank-operations", decoded).hasAccess).toBe(false);
  });

  it("管理者は全登録routeへアクセスできる", () => {
    const access = resolveAdminPermissionAccess("管理者", "/admin/security-rules", { kind: "missing" });
    expect(access.hasAccess).toBe(true);
    expect(access.capabilities).toContain("developer.securityRules.view");
  });

  it("registry未登録routeは管理者でもgateを通さない", () => {
    expect(resolveAdminPermissionAccess("管理者", "/admin/unknown", { kind: "missing" }).hasAccess).toBe(false);
  });
});
