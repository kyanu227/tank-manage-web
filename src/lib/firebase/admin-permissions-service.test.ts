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

import {
  getAdminPermissions,
  saveAdminPermissions,
} from "@/lib/firebase/admin-permissions-service";

describe("admin-permissions-service", () => {
  beforeEach(() => {
    mocks.doc.mockReset();
    mocks.doc.mockReturnValue({ path: "settings/adminPermissions" });
    mocks.getDoc.mockReset();
    mocks.setDoc.mockReset();
  });

  it("capability documentを返す", async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ capabilities: { "analytics.sales.view": ["準管理者"] } }),
    });

    await expect(getAdminPermissions()).resolves.toMatchObject({
      kind: "valid",
      source: "capabilities",
      capabilities: { "analytics.sales.view": ["準管理者"] },
    });
  });

  it("document不在は空のcapabilityを伴うmissingにする", async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    await expect(getAdminPermissions()).resolves.toEqual({ kind: "missing", capabilities: {} });
  });

  it("新規保存はpagesを二重writeせずcapabilitiesだけを保存する", async () => {
    await saveAdminPermissions({
      capabilities: { "dashboard.view": ["準管理者"] },
      actorRole: "管理者",
    });
    const payload = mocks.setDoc.mock.calls[0][1];

    expect(payload).toHaveProperty("capabilities");
    expect(payload).not.toHaveProperty("pages");
    expect(payload.capabilities["dashboard.view"]).toEqual(["管理者", "準管理者"]);
  });

  it("準管理者からのwriteを処理側でも拒否する", async () => {
    await expect(saveAdminPermissions({
      capabilities: { "dashboard.view": ["準管理者"] },
      actorRole: "準管理者",
    })).rejects.toThrow("管理者だけ");
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
