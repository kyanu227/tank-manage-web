import { describe, expect, it } from "vitest";
import {
  getPortalReturnGroupReadiness,
  getPortalReturnObservedCycleMarkers,
  type PortalReturnCycleReadinessInput,
} from "./return-cycle-readiness";

const IDENTITY_CUSTOMER_ID = "customer-01";

function getReadiness(
  overrides: Partial<PortalReturnCycleReadinessInput> = {},
) {
  return getPortalReturnGroupReadiness([
    {
      id: "TANK-01",
      customerId: IDENTITY_CUSTOMER_ID,
      latestLogId: "log-01",
      ...overrides,
    },
  ], IDENTITY_CUSTOMER_ID);
}

describe("getPortalReturnGroupReadiness", () => {
  it("両 marker が有効で customerId が identity と一致すれば ready", () => {
    const result = getReadiness();

    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("Expected ready result");
    expect(result.cycles).toEqual([{
      tank: {
        id: "TANK-01",
        customerId: IDENTITY_CUSTOMER_ID,
        latestLogId: "log-01",
      },
      customerId: IDENTITY_CUSTOMER_ID,
      latestLogId: "log-01",
    }]);
  });

  it("customerId だけが欠落していれば not ready", () => {
    expect(getReadiness({ customerId: undefined })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", reason: "invalid_customer_id" }],
    });
  });

  it("latestLogId だけが欠落していれば not ready", () => {
    expect(getReadiness({ latestLogId: undefined })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", reason: "invalid_latest_log_id" }],
    });
  });

  it("両 marker が欠落していれば両方を理由に not ready", () => {
    expect(getReadiness({ customerId: undefined, latestLogId: undefined })).toEqual({
      ready: false,
      issues: [
        { tankId: "TANK-01", reason: "invalid_customer_id" },
        { tankId: "TANK-01", reason: "invalid_latest_log_id" },
      ],
    });
  });

  it.each([
    { name: "null", value: null },
    { name: "空文字", value: "" },
    { name: "空白文字列", value: " \t\n" },
  ])("customerId が $name なら silent skip せず not ready", ({ value }) => {
    expect(getReadiness({ customerId: value }).ready).toBe(false);
  });

  it.each([
    { name: "null", value: null },
    { name: "空文字", value: "" },
    { name: "空白文字列", value: " \t\n" },
  ])("latestLogId が $name なら silent skip せず not ready", ({ value }) => {
    expect(getReadiness({ latestLogId: value }).ready).toBe(false);
  });

  it("rawCycleMarkers missing は正規化済み field を観測する", () => {
    expect(getPortalReturnObservedCycleMarkers({
      id: "TANK-01",
      customerId: IDENTITY_CUSTOMER_ID,
      latestLogId: "log-01",
    })).toEqual({
      customerId: IDENTITY_CUSTOMER_ID,
      latestLogId: "log-01",
    });
    expect(getReadiness().ready).toBe(true);
  });

  it("rawCycleMarkers の null は missing と区別して not ready にする", () => {
    const tank = {
      id: "TANK-01",
      customerId: IDENTITY_CUSTOMER_ID,
      latestLogId: "log-01",
      rawCycleMarkers: { customerId: null, latestLogId: null },
    };

    expect(getPortalReturnObservedCycleMarkers(tank)).toEqual({
      customerId: null,
      latestLogId: null,
    });
    expect(getPortalReturnGroupReadiness([tank], IDENTITY_CUSTOMER_ID)).toEqual({
      ready: false,
      issues: [
        { tankId: "TANK-01", reason: "invalid_customer_id" },
        { tankId: "TANK-01", reason: "invalid_latest_log_id" },
      ],
    });
  });

  it("観測 customerId が identity と不一致なら fallback 由来として not ready", () => {
    expect(getReadiness({ customerId: "legacy-customer" })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", reason: "customer_id_mismatch" }],
    });
  });

  it("rawCycleMarkers を正規化済み field より優先し、値を trim しない", () => {
    const result = getPortalReturnGroupReadiness([{
      id: "TANK-01",
      customerId: "normalized-customer",
      latestLogId: "normalized-log",
      rawCycleMarkers: {
        customerId: " customer-01 ",
        latestLogId: " log-raw ",
      },
    }], " customer-01 ");

    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("Expected ready result");
    expect(result.cycles[0]).toMatchObject({
      customerId: " customer-01 ",
      latestLogId: " log-raw ",
    });
  });

  it("valid と invalid の混在時は ready cycle を公開せず group 全体を止める", () => {
    const result = getPortalReturnGroupReadiness([
      {
        id: "VALID-01",
        customerId: IDENTITY_CUSTOMER_ID,
        latestLogId: "log-01",
      },
      {
        id: "INVALID-01",
        customerId: IDENTITY_CUSTOMER_ID,
        latestLogId: null,
      },
    ], IDENTITY_CUSTOMER_ID);

    expect(result).toEqual({
      ready: false,
      issues: [{ tankId: "INVALID-01", reason: "invalid_latest_log_id" }],
    });
    expect("cycles" in result).toBe(false);
  });
});
