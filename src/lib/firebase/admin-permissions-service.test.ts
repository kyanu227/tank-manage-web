import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
}));

vi.mock("@/lib/firebase/config", () => ({ db: {} }));

import { getAdminPermissions } from "@/lib/firebase/admin-permissions-service";

describe("getAdminPermissions", () => {
  beforeEach(() => {
    mocks.doc.mockReset();
    mocks.doc.mockReturnValue({ path: "settings/adminPermissions" });
    mocks.getDoc.mockReset();
    mocks.setDoc.mockReset();
  });

  it("正常な document は decoder 済みの pages を返す", async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ pages: { "/admin/sales": ["管理者", "準管理者"] } }),
    });

    await expect(getAdminPermissions(["/admin", "/admin/sales"])).resolves.toEqual({
      kind: "valid",
      pages: { "/admin/sales": ["管理者", "準管理者"] },
    });
  });

  it("document 不在は従来の default pages を伴う missing として返す", async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });

    await expect(getAdminPermissions(["/admin", "/admin/sales"])).resolves.toEqual({
      kind: "missing",
      pages: {
        "/admin": ["管理者", "準管理者"],
        "/admin/sales": ["管理者"],
      },
    });
  });

  it("malformed document に default pages を返さない", async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ pages: { "/admin/sales": "準管理者" } }),
    });

    const result = await getAdminPermissions(["/admin", "/admin/sales"]);

    expect(result).toMatchObject({ kind: "malformed" });
    expect(result).not.toHaveProperty("pages");
  });
});
