import { describe, expect, it } from "vitest";
import {
  getBulkReturnGroupReadiness,
  type BulkReturnCycleReadinessInput,
} from "./bulk-return-cycle-readiness";

function getReadiness(
  overrides: Partial<BulkReturnCycleReadinessInput> = {},
) {
  return getBulkReturnGroupReadiness([
    {
      id: "TANK-01",
      customerId: "customer-01",
      latestLogId: "log-01",
      ...overrides,
    },
  ]);
}

describe("getBulkReturnGroupReadiness", () => {
  it("customerId と latestLogId が両方あれば ready を返す", () => {
    expect(getReadiness()).toEqual({
      ready: true,
      issues: [],
    });
  });

  it("customerId が undefined なら不足と判定する", () => {
    expect(getReadiness({ customerId: undefined })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "customerId" }],
    });
  });

  it("customerId が null なら不足と判定する", () => {
    expect(getReadiness({ customerId: null })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "customerId" }],
    });
  });

  it("customerId が空文字なら不足と判定する", () => {
    expect(getReadiness({ customerId: "" })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "customerId" }],
    });
  });

  it("customerId が空白のみなら不足と判定する", () => {
    expect(getReadiness({ customerId: " \t " })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "customerId" }],
    });
  });

  it("latestLogId が undefined なら不足と判定する", () => {
    expect(getReadiness({ latestLogId: undefined })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "latestLogId" }],
    });
  });

  it("latestLogId が null なら不足と判定する", () => {
    expect(getReadiness({ latestLogId: null })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "latestLogId" }],
    });
  });

  it("latestLogId が空文字なら不足と判定する", () => {
    expect(getReadiness({ latestLogId: "" })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "latestLogId" }],
    });
  });

  it("latestLogId が空白のみなら不足と判定する", () => {
    expect(getReadiness({ latestLogId: "\n " })).toEqual({
      ready: false,
      issues: [{ tankId: "TANK-01", field: "latestLogId" }],
    });
  });

  it("同一 tank の両 field 不足を customerId、latestLogId の順で返す", () => {
    expect(getReadiness({
      customerId: null,
      latestLogId: undefined,
    })).toEqual({
      ready: false,
      issues: [
        { tankId: "TANK-01", field: "customerId" },
        { tankId: "TANK-01", field: "latestLogId" },
      ],
    });
  });

  it("valid と invalid の混在時は invalid tank の issue だけを返す", () => {
    expect(getBulkReturnGroupReadiness([
      {
        id: "VALID-01",
        customerId: "customer-01",
        latestLogId: "log-01",
      },
      {
        id: "INVALID-01",
        customerId: "",
        latestLogId: "log-02",
      },
    ])).toEqual({
      ready: false,
      issues: [
        { tankId: "INVALID-01", field: "customerId" },
      ],
    });
  });

  it("複数 invalid tank の issue を tank 入力順と field 順で返す", () => {
    expect(getBulkReturnGroupReadiness([
      {
        id: "INVALID-02",
        customerId: "customer-02",
        latestLogId: null,
      },
      {
        id: "INVALID-01",
        customerId: undefined,
        latestLogId: "",
      },
    ])).toEqual({
      ready: false,
      issues: [
        { tankId: "INVALID-02", field: "latestLogId" },
        { tankId: "INVALID-01", field: "customerId" },
        { tankId: "INVALID-01", field: "latestLogId" },
      ],
    });
  });

  it("入力 array と tank object を変更しない", () => {
    const validTank = Object.freeze({
      id: "VALID-01",
      customerId: " customer-01 ",
      latestLogId: " log-01 ",
    });
    const invalidTank = Object.freeze({
      id: "INVALID-01",
      customerId: null,
      latestLogId: "log-02",
    });
    const tanks = Object.freeze([validTank, invalidTank]);

    getBulkReturnGroupReadiness(tanks);

    expect(tanks).toEqual([validTank, invalidTank]);
    expect(validTank).toEqual({
      id: "VALID-01",
      customerId: " customer-01 ",
      latestLogId: " log-01 ",
    });
    expect(invalidTank).toEqual({
      id: "INVALID-01",
      customerId: null,
      latestLogId: "log-02",
    });
  });

  it("非 string 値は両 field とも不足と判定する", () => {
    expect(getReadiness({
      customerId: 123,
      latestLogId: { id: "log-01" },
    })).toEqual({
      ready: false,
      issues: [
        { tankId: "TANK-01", field: "customerId" },
        { tankId: "TANK-01", field: "latestLogId" },
      ],
    });
  });

  it("前後に空白がある非空 string は A1 と同じく valid と判定する", () => {
    expect(getReadiness({
      customerId: " customer-01 ",
      latestLogId: " log-01 ",
    })).toEqual({
      ready: true,
      issues: [],
    });
  });
});
