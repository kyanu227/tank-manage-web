import { describe, expect, it, vi } from "vitest";
import { decodeAdminPermissions } from "@/lib/admin/admin-permissions";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/sales" }));
vi.mock("@/lib/firebase/config", () => ({ auth: {}, db: {} }));
vi.mock("@/lib/firebase/staff-auth", () => ({
  findActiveStaffByEmail: vi.fn(),
}));

import { resolveAdminPermissionAccess } from "@/components/AdminAuthGuard";

describe("AdminAuthGuard permission resolution", () => {
  it("pages[path] が string の malformed data では準管理者を許可しない", () => {
    const decoded = decodeAdminPermissions({
      pages: { "/admin/sales": "準管理者" },
    });

    expect(resolveAdminPermissionAccess("準管理者", "/admin/sales", decoded)).toEqual({
      hasAccess: false,
      allowedPaths: [],
    });
  });

  it("malformed data では準管理者を全拒否する", () => {
    const decoded = decodeAdminPermissions({ pages: null });

    expect(resolveAdminPermissionAccess("準管理者", "/admin/sales", decoded)).toEqual({
      hasAccess: false,
      allowedPaths: [],
    });
  });

  it("missing document では準管理者を全拒否する", () => {
    const decoded = decodeAdminPermissions(undefined);

    expect(resolveAdminPermissionAccess("準管理者", "/admin/sales", decoded)).toEqual({
      hasAccess: false,
      allowedPaths: [],
    });
  });

  it("正常な data では従来どおり準管理者を許可する", () => {
    const decoded = decodeAdminPermissions({
      pages: { "/admin/sales": ["管理者", "準管理者"] },
    });

    expect(resolveAdminPermissionAccess("準管理者", "/admin/sales", decoded)).toEqual({
      hasAccess: true,
      allowedPaths: ["/admin/sales"],
    });
  });

  it("管理者は decode 結果にかかわらず全権を持つ", () => {
    const decoded = decodeAdminPermissions({ pages: null });
    const access = resolveAdminPermissionAccess("管理者", "/admin/sales", decoded);

    expect(access.hasAccess).toBe(true);
    expect(access.allowedPaths).toContain("/admin/sales");
  });
});
