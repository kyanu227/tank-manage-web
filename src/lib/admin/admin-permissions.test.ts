import { describe, expect, it } from "vitest";
import {
  convertLegacyAdminPathPermissions,
  decodeAdminPermissions,
  normalizeAdminCapabilityGrantsForSave,
} from "@/lib/admin/admin-permissions";

describe("decodeAdminPermissions", () => {
  it("capability正本をvalidとして返す", () => {
    expect(decodeAdminPermissions({
      capabilities: { "analytics.sales.view": ["管理者", "準管理者"] },
    })).toEqual({
      kind: "valid",
      capabilities: { "analytics.sales.view": ["管理者", "準管理者"] },
      source: "capabilities",
      ignoredLegacyPaths: [],
    });
  });

  it("document不在をmissingとして返す", () => {
    expect(decodeAdminPermissions(undefined)).toEqual({ kind: "missing" });
  });

  it("旧path権限をcapabilityへ決定的に変換する", () => {
    const decoded = decodeAdminPermissions({
      pages: {
        "/admin/sales": ["管理者", "準管理者"],
        "/admin/order-master": ["管理者", "準管理者"],
      },
    });

    expect(decoded).toMatchObject({
      kind: "valid",
      source: "legacy-paths",
      capabilities: {
        "analytics.sales.view": ["管理者", "準管理者"],
        "orderMaster.view": ["管理者", "準管理者"],
        "orderMaster.manage": ["管理者", "準管理者"],
      },
    });
  });

  it("旧adminOnly pathは準管理者capabilityへ変換しない", () => {
    const converted = convertLegacyAdminPathPermissions({
      "/admin/operation-reviews": ["管理者", "準管理者"],
      "/admin/security-rules": ["管理者", "準管理者"],
    });

    expect(converted.capabilities).toEqual({});
  });

  it("旧customers pathは取引先の両read capabilityへ変換する", () => {
    const converted = convertLegacyAdminPathPermissions({
      "/admin/customers": ["準管理者"],
    });

    expect(converted.capabilities).toMatchObject({
      "customers.view": ["準管理者"],
      "customerPortalUsers.view": ["準管理者"],
    });
  });

  it("未知の旧pathを権限へ変換しない", () => {
    const converted = convertLegacyAdminPathPermissions({
      "/admin/unknown": ["準管理者"],
    });

    expect(converted.capabilities).toEqual({});
    expect(converted.ignoredLegacyPaths).toEqual(["/admin/unknown"]);
  });

  it.each([
    [{ capabilities: null }],
    [{ capabilities: { "analytics.sales.view": "準管理者" } }],
    [{ capabilities: { "analytics.sales.view": ["準管理者", 1] } }],
    [{ capabilities: { "unknown.view": ["準管理者"] } }],
    [{ pages: null }],
  ])("malformed documentはfail-closedにする", (raw) => {
    expect(decodeAdminPermissions(raw)).toMatchObject({ kind: "malformed" });
  });

  it("新規保存ではcapabilityだけを正規化し管理者を必ず含める", () => {
    const normalized = normalizeAdminCapabilityGrantsForSave({
      "dashboard.view": ["準管理者"],
    });

    expect(normalized["dashboard.view"]).toEqual(["管理者", "準管理者"]);
    expect(normalized["reviews.approve"]).toEqual(["管理者"]);
  });
});
