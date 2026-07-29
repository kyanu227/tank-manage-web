import { describe, expect, it } from "vitest";
import {
  buildStaffDashboardReadModel,
  sortStaffDashboardLogs,
  type BuildStaffDashboardReadModelInput,
  type DashboardLogEntry,
} from "@/features/staff-dashboard/queries/dashboard-read-model";
import type { TransactionDoc } from "@/lib/firebase/repositories/types";
import type { TankDoc } from "@/lib/tank-types";

function makeTank(
  overrides: Pick<TankDoc, "id"> & Partial<TankDoc>,
): TankDoc {
  return {
    status: "filled",
    ...overrides,
  };
}

function makeLog(
  overrides: Pick<DashboardLogEntry, "id"> & Partial<DashboardLogEntry>,
): DashboardLogEntry {
  return {
    tankId: "A-01",
    action: "lend",
    ...overrides,
  };
}

function makeReport(
  id: string,
  overrides: Partial<TransactionDoc> = {},
): TransactionDoc {
  return {
    id,
    type: "uncharged_report",
    status: "pending",
    ...overrides,
  };
}

function buildReadModel(
  overrides: Partial<BuildStaffDashboardReadModelInput> = {},
) {
  return buildStaffDashboardReadModel({
    tanks: [],
    logs: [],
    customerOptions: [],
    unfilledReports: [],
    staffLocale: "ja",
    nowMillis: new Date(2026, 6, 27, 12, 0, 0, 0).getTime(),
    ...overrides,
  });
}

describe("buildStaffDashboardReadModel tank summary", () => {
  it("全tankをcanonical status・raw status・不明へ集計しzero keyを追加しない", () => {
    const tanks = Object.freeze([
      Object.freeze(makeTank({ id: "A-01", status: "貸出中" })),
      Object.freeze(makeTank({ id: "A-02", status: "lent" })),
      Object.freeze(makeTank({ id: "A-03", status: "custom-status" })),
      Object.freeze({
        id: "A-04",
        status: null,
      } as unknown as TankDoc),
    ]);

    const result = buildReadModel({ tanks });

    expect(result.totalTanks).toBe(4);
    expect(result.tankSummary).toStrictEqual({
      lent: 2,
      "custom-status": 1,
      不明: 1,
    });
    expect(result.tankSummary).not.toHaveProperty("filled");
    expect(tanks.map((tank) => tank.id)).toStrictEqual([
      "A-01",
      "A-02",
      "A-03",
      "A-04",
    ]);
  });
});

describe("buildStaffDashboardReadModel byLocation", () => {
  it("customerId正本・master名優先・legacy fallback・unknownを現行groupへ集計する", () => {
    const tanks = Object.freeze([
      Object.freeze(makeTank({
        id: "A-01",
        status: "lent",
        customerId: " customer-1 ",
        customerName: "Old Customer",
        location: "Old Location",
      })),
      Object.freeze(makeTank({
        id: "A-02",
        status: "未返却",
        customerId: "customer-1",
        customerName: "Another Old Customer",
      })),
      Object.freeze(makeTank({
        id: "A-03",
        status: "lent",
        customerName: "Alpha Legacy",
        location: "Ignored Location",
      })),
      Object.freeze(makeTank({
        id: "A-04",
        status: "unreturned",
        location: "Beta Legacy",
      })),
      Object.freeze(makeTank({
        id: "A-05",
        status: "lent",
      })),
      Object.freeze(makeTank({
        id: "A-06",
        status: "filled",
        customerId: "customer-1",
      })),
    ]);
    const customerOptions = Object.freeze([
      Object.freeze({
        customerId: "customer-1",
        customerName: "Current Customer",
      }),
    ]);

    const result = buildReadModel({
      tanks,
      customerOptions,
    });

    expect(result.byLocation[0]).toStrictEqual({
      key: "customer:customer-1",
      customerId: "customer-1",
      displayName: "Current Customer",
      lent: 1,
      unreturned: 1,
      total: 2,
      isLegacy: false,
    });

    const byKey = Object.fromEntries(
      result.byLocation.map((group) => [group.key, group]),
    );
    expect(byKey["legacy-location:Alpha Legacy"]).toStrictEqual({
      key: "legacy-location:Alpha Legacy",
      customerId: undefined,
      displayName: "Alpha Legacy",
      lent: 1,
      unreturned: 0,
      total: 1,
      isLegacy: true,
    });
    expect(byKey["legacy-location:Beta Legacy"]).toStrictEqual({
      key: "legacy-location:Beta Legacy",
      customerId: undefined,
      displayName: "Beta Legacy",
      lent: 0,
      unreturned: 1,
      total: 1,
      isLegacy: true,
    });
    expect(byKey["legacy-location:__unknown__"]).toStrictEqual({
      key: "legacy-location:__unknown__",
      customerId: undefined,
      displayName: "未設定",
      lent: 1,
      unreturned: 0,
      total: 1,
      isLegacy: true,
    });
    expect(result.byLocation).toHaveLength(4);
    expect(tanks[0].customerName).toBe("Old Customer");
    expect(customerOptions[0].customerName).toBe("Current Customer");
  });

  it("同数groupをdisplayNameのlocaleCompare順にする", () => {
    const result = buildReadModel({
      tanks: [
        makeTank({
          id: "A-01",
          status: "lent",
          location: "Zulu",
        }),
        makeTank({
          id: "A-02",
          status: "unreturned",
          location: "Alpha",
        }),
      ],
    });

    expect(
      result.byLocation.map((group) => group.displayName),
    ).toStrictEqual(["Alpha", "Zulu"]);
  });
});

describe("buildStaffDashboardReadModel todayStats", () => {
  it("runtime local day・originalAt優先・現行NaN算入・表示label groupを維持する", () => {
    const nowMillis =
      new Date(2026, 6, 27, 12, 0, 0, 0).getTime();
    const startOfDay =
      new Date(2026, 6, 27, 0, 0, 0, 0).getTime();

    const logs = Object.freeze([
      Object.freeze(makeLog({
        id: "before",
        timestamp: startOfDay - 1,
        action: "Alpha",
      })),
      Object.freeze(makeLog({
        id: "at-start",
        timestamp: startOfDay,
        action: "lend",
      })),
      Object.freeze(makeLog({
        id: "future",
        timestamp: startOfDay + (2 * 24 * 60 * 60 * 1000),
        action: "貸出",
      })),
      Object.freeze(makeLog({
        id: "original-priority",
        originalAt: startOfDay - 1,
        timestamp: startOfDay + 1,
        action: "Alpha",
      })),
      Object.freeze(makeLog({
        id: "null-original-fallback",
        originalAt: null,
        timestamp: startOfDay,
        action: "Alpha",
      })),
      Object.freeze(makeLog({
        id: "null",
        timestamp: null,
        action: "Alpha",
      })),
      Object.freeze(makeLog({
        id: "raw-nan",
        timestamp: Number.NaN,
        action: "Alpha",
      })),
      Object.freeze(makeLog({
        id: "invalid-date",
        timestamp: new Date("invalid"),
        action: "Zeta",
      })),
      Object.freeze(makeLog({
        id: "invalid-to-date",
        timestamp: { toDate: () => new Date("invalid") },
        action: "Zeta",
      })),
      Object.freeze(makeLog({
        id: "invalid-to-millis",
        timestamp: { toMillis: () => Number.NaN },
        action: "Beta",
      })),
    ]);

    const result = buildReadModel({
      logs,
      staffLocale: "en",
      nowMillis,
    });

    expect(result.todayStats).toStrictEqual({
      total: 6,
      breakdown: [
        { action: "Lend", count: 2 },
        { action: "Zeta", count: 2 },
        { action: "Alpha", count: 1 },
        { action: "Beta", count: 1 },
      ],
    });
    expect(logs.map((log) => log.id)).toStrictEqual([
      "before",
      "at-start",
      "future",
      "original-priority",
      "null-original-fallback",
      "null",
      "raw-nan",
      "invalid-date",
      "invalid-to-date",
      "invalid-to-millis",
    ]);
  });
});

describe("buildStaffDashboardReadModel recent reports", () => {
  it("filter・sortせず先頭5件だけを別配列で返す", () => {
    const reports = Object.freeze([
      Object.freeze(makeReport("R-01", { status: "completed" })),
      Object.freeze(makeReport("R-02", { source: "customer_portal" })),
      Object.freeze(makeReport("R-03", { customerId: "customer-1" })),
      Object.freeze(makeReport("R-04")),
      Object.freeze(makeReport("R-05")),
      Object.freeze(makeReport("R-06")),
      Object.freeze(makeReport("R-07")),
    ]);

    const result = buildReadModel({
      unfilledReports: reports,
    });

    expect(
      result.recentUnfilledReports.map((report) => report.id),
    ).toStrictEqual(["R-01", "R-02", "R-03", "R-04", "R-05"]);
    expect(result.recentUnfilledReports).not.toBe(reports);
    expect(result.recentUnfilledReports[0]).toBe(reports[0]);
    expect(reports.map((report) => report.id)).toStrictEqual([
      "R-01",
      "R-02",
      "R-03",
      "R-04",
      "R-05",
      "R-06",
      "R-07",
    ]);
  });

  it("5件以下の入力を順序どおり維持する", () => {
    const reports = [
      makeReport("R-02"),
      makeReport("R-01"),
    ];

    expect(
      buildReadModel({
        unfilledReports: reports,
      }).recentUnfilledReports,
    ).toStrictEqual(reports);
  });
});

describe("sortStaffDashboardLogs", () => {
  it("valid Date・number・toDate・toMillis・stringをdesc/ascへsortする", () => {
    const hour1 = new Date(2026, 0, 2, 1, 0, 0, 0).getTime();
    const hour2 = new Date(2026, 0, 2, 2, 0, 0, 0).getTime();
    const hour3 = new Date(2026, 0, 2, 3, 0, 0, 0).getTime();
    const hour4 = new Date(2026, 0, 2, 4, 0, 0, 0).getTime();
    const logs = Object.freeze([
      Object.freeze(makeLog({
        id: "date",
        timestamp: new Date(hour1),
      })),
      Object.freeze(makeLog({
        id: "number",
        timestamp: hour2,
      })),
      Object.freeze(makeLog({
        id: "to-date",
        timestamp: { toDate: () => new Date(hour3) },
      })),
      Object.freeze(makeLog({
        id: "to-millis",
        timestamp: { toMillis: () => hour4 },
      })),
      Object.freeze(makeLog({
        id: "string",
        timestamp: "2026-01-02 05:00:00",
      })),
    ]);

    expect(
      sortStaffDashboardLogs(logs, "desc").map((log) => log.id),
    ).toStrictEqual([
      "string",
      "to-millis",
      "to-date",
      "number",
      "date",
    ]);
    expect(
      sortStaffDashboardLogs(logs, "asc").map((log) => log.id),
    ).toStrictEqual([
      "date",
      "number",
      "to-date",
      "to-millis",
      "string",
    ]);
    expect(logs.map((log) => log.id)).toStrictEqual([
      "date",
      "number",
      "to-date",
      "to-millis",
      "string",
    ]);
  });

  it("originalAtをtimestampより優先しrevisionCreatedAtを使わない", () => {
    const logs = [
      makeLog({
        id: "original",
        originalAt: 100,
        timestamp: 500,
        revisionCreatedAt: 1000,
      }),
      makeLog({
        id: "timestamp",
        timestamp: 300,
        revisionCreatedAt: 2000,
      }),
      makeLog({
        id: "null-original",
        originalAt: null,
        timestamp: 400,
        revisionCreatedAt: 0,
      }),
    ];

    expect(
      sortStaffDashboardLogs(logs, "desc").map((log) => log.id),
    ).toStrictEqual([
      "null-original",
      "timestamp",
      "original",
    ]);
  });

  it("nullish・falsy・raw NaN・invalid stringだけを0へfallbackしstable順を維持する", () => {
    const logs = [
      makeLog({ id: "zero", timestamp: 0 }),
      makeLog({ id: "raw-nan", timestamp: Number.NaN }),
      makeLog({ id: "invalid-string", timestamp: "not-a-date" }),
      makeLog({ id: "null", timestamp: null }),
      makeLog({ id: "missing" }),
      makeLog({ id: "empty-string", timestamp: "" }),
      makeLog({
        id: "false",
        timestamp:
          false as unknown as DashboardLogEntry["timestamp"],
      }),
      makeLog({ id: "positive", timestamp: 100 }),
    ];

    expect(
      sortStaffDashboardLogs(logs, "desc").map((log) => log.id),
    ).toStrictEqual([
      "positive",
      "zero",
      "raw-nan",
      "invalid-string",
      "null",
      "missing",
      "empty-string",
      "false",
    ]);
    expect(logs.map((log) => log.id)).toStrictEqual([
      "zero",
      "raw-nan",
      "invalid-string",
      "null",
      "missing",
      "empty-string",
      "false",
      "positive",
    ]);
  });

  it.each([
    ["Invalid Date", new Date("invalid")],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    [
      "Invalid Dateを返すtoDate",
      { toDate: () => new Date("invalid") },
    ],
    [
      "NaNを返すtoMillis",
      { toMillis: () => Number.NaN },
    ],
    [
      "Infinityを返すtoMillis",
      { toMillis: () => Number.POSITIVE_INFINITY },
    ],
  ])("%sを0へ正規化しない", (_name, timestamp) => {
    const logs = [
      makeLog({
        id: "invalid",
        timestamp,
      }),
      makeLog({
        id: "valid",
        timestamp: 100,
      }),
    ];

    expect(
      sortStaffDashboardLogs(logs, "desc").map((log) => log.id),
    ).toStrictEqual(["invalid", "valid"]);
  });

  it("NaN comparatorを含む現行runtime結果をasc/desc双方で維持する", () => {
    const logs = [
      makeLog({
        id: "invalid",
        timestamp: new Date("invalid"),
      }),
      makeLog({
        id: "newest",
        timestamp: 300,
      }),
      makeLog({
        id: "oldest",
        timestamp: 100,
      }),
    ];

    expect(
      sortStaffDashboardLogs(logs, "desc").map((log) => log.id),
    ).toStrictEqual(["invalid", "newest", "oldest"]);
    expect(
      sortStaffDashboardLogs(logs, "asc").map((log) => log.id),
    ).toStrictEqual(["invalid", "oldest", "newest"]);
  });

  it("同一millisでは入力のstable順を維持する", () => {
    const logs = [
      makeLog({ id: "first", timestamp: 100 }),
      makeLog({ id: "second", timestamp: 100 }),
      makeLog({ id: "third", timestamp: 100 }),
    ];

    expect(
      sortStaffDashboardLogs(logs, "desc").map((log) => log.id),
    ).toStrictEqual(["first", "second", "third"]);
  });
});
