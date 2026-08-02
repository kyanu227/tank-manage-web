import { describe, expect, it } from "vitest";
import {
  decodeAdminPermissions,
  isRoleAllowed,
} from "@/lib/admin/admin-permissions";

describe("decodeAdminPermissions", () => {
  it("正常な権限設定を valid として返す", () => {
    expect(decodeAdminPermissions({
      pages: { "/admin": ["管理者", "準管理者"] },
    })).toEqual({
      kind: "valid",
      pages: { "/admin": ["管理者", "準管理者"] },
    });
  });

  it("document 不在を missing として返す", () => {
    expect(decodeAdminPermissions(undefined)).toEqual({ kind: "missing" });
  });

  it("pages field 不在を malformed として返す", () => {
    expect(decodeAdminPermissions({})).toMatchObject({ kind: "malformed" });
  });

  it("pages が null のとき malformed として返す", () => {
    expect(decodeAdminPermissions({ pages: null })).toMatchObject({ kind: "malformed" });
  });

  it.each([
    ["string", "準管理者"],
    ["number", 1],
    ["array", []],
  ])("pages が %s のとき malformed として返す", (_label, pages) => {
    expect(decodeAdminPermissions({ pages })).toMatchObject({ kind: "malformed" });
  });

  it("pages[path] が string のとき malformed として返す", () => {
    expect(decodeAdminPermissions({
      pages: { "/admin/xxx": "準管理者" },
    })).toMatchObject({ kind: "malformed" });
  });

  it("pages[path] が null のとき malformed として返す", () => {
    expect(decodeAdminPermissions({
      pages: { "/admin/xxx": null },
    })).toMatchObject({ kind: "malformed" });
  });

  it("role 配列に非 string 要素があれば silent に除去せず malformed として返す", () => {
    expect(decodeAdminPermissions({
      pages: { "/admin/xxx": ["準管理者", 1] },
    })).toMatchObject({ kind: "malformed" });
  });

  it("空の pages object を valid として返す", () => {
    expect(decodeAdminPermissions({ pages: {} })).toEqual({
      kind: "valid",
      pages: {},
    });
  });
});

describe("isRoleAllowed", () => {
  it("strict 等価の role を許可する", () => {
    expect(isRoleAllowed(["準管理者"], "準管理者")).toBe(true);
  });

  it("部分一致では許可しない", () => {
    expect(isRoleAllowed(["準管理者だった人"], "準管理者")).toBe(false);
  });

  it("空配列では許可しない", () => {
    expect(isRoleAllowed([], "準管理者")).toBe(false);
  });
});
