import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listActiveCustomerSnapshots } from "@/lib/firebase/customers-service";
import {
  logsRepository,
  transactionsRepository,
} from "@/lib/firebase/repositories";
import type {
  LogDoc,
  TransactionDoc,
} from "@/lib/firebase/repositories/types";
import type { CustomerSnapshot } from "@/lib/operation-context";
import {
  fetchStaffDashboardLogHistory,
  fetchStaffDashboardSourceData,
} from "./dashboard-query";
import type { DashboardLogEntry } from "./dashboard-read-model";

const mocks = vi.hoisted(() => ({
  getActiveLogs: vi.fn(),
  getLogsByRoot: vi.fn(),
  getUnchargedReports: vi.fn(),
  listActiveCustomerSnapshots: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories", () => ({
  logsRepository: {
    getActiveLogs: mocks.getActiveLogs,
    getLogsByRoot: mocks.getLogsByRoot,
  },
  transactionsRepository: {
    getUnchargedReports: mocks.getUnchargedReports,
  },
}));

vi.mock("@/lib/firebase/customers-service", () => ({
  listActiveCustomerSnapshots: mocks.listActiveCustomerSnapshots,
}));

const getActiveLogsMock = vi.mocked(logsRepository.getActiveLogs);
const getLogsByRootMock = vi.mocked(logsRepository.getLogsByRoot);
const getUnchargedReportsMock = vi.mocked(
  transactionsRepository.getUnchargedReports,
);
const listActiveCustomerSnapshotsMock = vi.mocked(
  listActiveCustomerSnapshots,
);

const OLDEST_MILLIS = 1_000;
const MIDDLE_MILLIS = 2_000;
const NEWEST_MILLIS = 3_000;

function makeLog(
  id: string,
  overrides: Partial<LogDoc> = {},
): LogDoc {
  return {
    id,
    logStatus: "active",
    logKind: "tank",
    rootLogId: id,
    revision: 0,
    tankId: id,
    action: "貸出",
    ...overrides,
  };
}

function makeReport(
  id: string,
  createdAt?: unknown,
  overrides: Partial<TransactionDoc> = {},
): TransactionDoc {
  return {
    id,
    type: "uncharged_report",
    status: "pending",
    ...(createdAt === undefined ? {} : { createdAt }),
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  getActiveLogsMock.mockReset();
  getActiveLogsMock.mockResolvedValue([]);
  getLogsByRootMock.mockReset();
  getLogsByRootMock.mockResolvedValue([]);
  getUnchargedReportsMock.mockReset();
  getUnchargedReportsMock.mockResolvedValue([]);
  listActiveCustomerSnapshotsMock.mockReset();
  listActiveCustomerSnapshotsMock.mockResolvedValue([]);
});

describe("fetchStaffDashboardSourceData", () => {
  it("3readをexact引数で同時開始し、全read完了後にexact keyで返す", async () => {
    const sourceLogs = [makeLog("log-001")];
    const sourceCustomers = [
      {
        customerId: "customer-001",
        customerName: "顧客A",
      },
    ] satisfies CustomerSnapshot[];
    const sourceReports = [makeReport("report-001", NEWEST_MILLIS)];
    const logsRead = createDeferred<LogDoc[]>();
    const customersRead = createDeferred<CustomerSnapshot[]>();
    const reportsRead = createDeferred<TransactionDoc[]>();
    getActiveLogsMock.mockReturnValueOnce(logsRead.promise);
    listActiveCustomerSnapshotsMock.mockReturnValueOnce(customersRead.promise);
    getUnchargedReportsMock.mockReturnValueOnce(reportsRead.promise);

    let settled = false;
    const resultPromise = fetchStaffDashboardSourceData();
    void resultPromise.then(() => {
      settled = true;
    });

    expect(getActiveLogsMock.mock.calls).toStrictEqual([
      [{ orderBy: null }],
    ]);
    expect(listActiveCustomerSnapshotsMock.mock.calls).toStrictEqual([[]]);
    expect(getUnchargedReportsMock.mock.calls).toStrictEqual([[]]);
    expect(settled).toBe(false);

    logsRead.resolve(sourceLogs);
    await flushMicrotasks();
    expect(settled).toBe(false);

    customersRead.resolve(sourceCustomers);
    await flushMicrotasks();
    expect(settled).toBe(false);

    reportsRead.resolve(sourceReports);
    const result = await resultPromise;

    expect(Object.keys(result).sort()).toStrictEqual([
      "customerOptions",
      "logs",
      "unfilledReports",
    ]);
    expect(result.logs).toStrictEqual(sourceLogs);
    expect(result.customerOptions).toBe(sourceCustomers);
    expect(result.unfilledReports).toStrictEqual(sourceReports);
  });

  it("active logsをrepository返却順の先頭200件へsort前に制限する", async () => {
    const sourceLogs = Array.from(
      { length: 202 },
      (_, index) => makeLog(
        `log-${String(index).padStart(3, "0")}`,
        {
          timestamp: {
            toMillis: () => index,
          } as LogDoc["timestamp"],
        },
      ),
    );
    const sourceOrder = [...sourceLogs];
    getActiveLogsMock.mockResolvedValueOnce(sourceLogs);

    const result = await fetchStaffDashboardSourceData();

    expect(result.logs).not.toBe(sourceLogs);
    expect(result.logs).toHaveLength(200);
    expect(result.logs.map((log) => log.id)).toStrictEqual(
      sourceLogs.slice(0, 200).map((log) => log.id),
    );
    expect(result.logs[0]).toBe(sourceLogs[0]);
    expect(result.logs[199]).toBe(sourceLogs[199]);
    expect(result.logs.some((log) => log.id === "log-200")).toBe(false);
    expect(result.logs.some((log) => log.id === "log-201")).toBe(false);
    expect(sourceLogs).toStrictEqual(sourceOrder);
  });

  it("customer配列の順序・参照・fieldを変更せず返す", async () => {
    const sourceCustomers = [
      {
        customerId: "customer-z",
        customerName: "Z",
      },
      {
        customerId: "customer-a",
        customerName: "A",
      },
    ] satisfies CustomerSnapshot[];
    listActiveCustomerSnapshotsMock.mockResolvedValueOnce(sourceCustomers);

    const result = await fetchStaffDashboardSourceData();

    expect(result.customerOptions).toBe(sourceCustomers);
    expect(result.customerOptions).toStrictEqual([
      {
        customerId: "customer-z",
        customerName: "Z",
      },
      {
        customerId: "customer-a",
        customerName: "A",
      },
    ]);
    expect(result.customerOptions[0]).toBe(sourceCustomers[0]);
    expect(result.customerOptions[1]).toBe(sourceCustomers[1]);
  });

  it("未充填報告を現行createdAt式で降順sortし、sourceを変更しない", async () => {
    const sourceReports = [
      makeReport("oldest", new Date(OLDEST_MILLIS)),
      makeReport("missing"),
      makeReport("newest", NEWEST_MILLIS),
      makeReport("middle-to-date", {
        toDate: () => new Date(MIDDLE_MILLIS),
      }),
      makeReport("middle-to-millis", {
        toMillis: () => MIDDLE_MILLIS,
      }),
      makeReport("null", null),
    ];
    const sourceOrder = [...sourceReports];
    getUnchargedReportsMock.mockResolvedValueOnce(sourceReports);

    const result = await fetchStaffDashboardSourceData();

    expect(result.unfilledReports).not.toBe(sourceReports);
    expect(result.unfilledReports.map((report) => report.id)).toStrictEqual([
      "newest",
      "middle-to-date",
      "middle-to-millis",
      "oldest",
      "missing",
      "null",
    ]);
    expect(sourceReports).toStrictEqual(sourceOrder);
    result.unfilledReports.forEach((report) => {
      expect(sourceReports).toContain(report);
    });
  });

  it("未充填報告をstatus・customerIdでfilterせず全件をsort対象にする", async () => {
    const completedCustomerB = makeReport(
      "completed-customer-b",
      NEWEST_MILLIS,
      {
        status: "completed",
        customerId: "customer-b",
      },
    );
    const pendingCustomerA = makeReport(
      "pending-customer-a",
      OLDEST_MILLIS,
      {
        status: "pending",
        customerId: "customer-a",
      },
    );
    const reviewedCustomerC = makeReport(
      "reviewed-customer-c",
      MIDDLE_MILLIS,
      {
        status: "reviewed",
        customerId: "customer-c",
      },
    );
    const sourceReports = [
      pendingCustomerA,
      completedCustomerB,
      reviewedCustomerC,
    ];
    getUnchargedReportsMock.mockResolvedValueOnce(sourceReports);

    const result = await fetchStaffDashboardSourceData();

    expect(getUnchargedReportsMock.mock.calls).toStrictEqual([[]]);
    expect(result.unfilledReports).toStrictEqual([
      completedCustomerB,
      reviewedCustomerC,
      pendingCustomerA,
    ]);
    expect(result.unfilledReports.map((report) => report.status)).toStrictEqual([
      "completed",
      "reviewed",
      "pending",
    ]);
    expect(result.unfilledReports.map((report) => report.customerId)).toStrictEqual([
      "customer-b",
      "customer-c",
      "customer-a",
    ]);
  });

  it("valid stringをreplace後のDateとして現行どおりsortする", async () => {
    const sourceReports = [
      makeReport("older-string", "2026-07-26"),
      makeReport("newer-string", "2026-07-27"),
    ];
    getUnchargedReportsMock.mockResolvedValueOnce(sourceReports);

    const result = await fetchStaffDashboardSourceData();

    expect(result.unfilledReports.map((report) => report.id)).toStrictEqual([
      "newer-string",
      "older-string",
    ]);
  });

  it("未充填報告をsort後の先頭10件へ制限する", async () => {
    const sourceReports = Array.from(
      { length: 12 },
      (_, index) => makeReport(`report-${index}`, index + 1),
    );
    const sourceOrder = [...sourceReports];
    getUnchargedReportsMock.mockResolvedValueOnce(sourceReports);

    const result = await fetchStaffDashboardSourceData();

    expect(result.unfilledReports).toHaveLength(10);
    expect(result.unfilledReports.map((report) => report.id)).toStrictEqual([
      "report-11",
      "report-10",
      "report-9",
      "report-8",
      "report-7",
      "report-6",
      "report-5",
      "report-4",
      "report-3",
      "report-2",
    ]);
    expect(sourceReports).toStrictEqual(sourceOrder);
  });

  it.each([
    ["Invalid Date", new Date(Number.NaN)],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["Invalid Dateを返すtoDate", { toDate: () => new Date(Number.NaN) }],
    ["NaNを返すtoMillis", { toMillis: () => Number.NaN }],
    ["Infinityを返すtoMillis", { toMillis: () => Number.POSITIVE_INFINITY }],
  ])("%s由来のNaNを0へ変換せず現行stable sort結果を維持する", async (
    _label,
    invalidCreatedAt,
  ) => {
    const invalidReport = makeReport("invalid", invalidCreatedAt);
    const validReport = makeReport("valid", NEWEST_MILLIS);
    const sourceReports = [invalidReport, validReport];
    getUnchargedReportsMock.mockResolvedValueOnce(sourceReports);

    const result = await fetchStaffDashboardSourceData();

    expect(result.unfilledReports).toStrictEqual([
      invalidReport,
      validReport,
    ]);
  });

  it.each([
    ["number 0", 0],
    ["raw NaN", Number.NaN],
    ["null", null],
    ["false", false],
    ["empty string", ""],
    ["invalid string", "not-a-date"],
  ])("%sをnullish timestampとして0へfallbackする", async (
    _label,
    nullishCreatedAt,
  ) => {
    const nullishReport = makeReport("nullish", nullishCreatedAt);
    const validReport = makeReport("valid", NEWEST_MILLIS);
    const sourceReports = [nullishReport, validReport];
    getUnchargedReportsMock.mockResolvedValueOnce(sourceReports);

    const result = await fetchStaffDashboardSourceData();

    expect(result.unfilledReports).toStrictEqual([
      validReport,
      nullishReport,
    ]);
  });

  it.each([
    {
      label: "active logs",
      rejectRead: (error: Error) => {
        getActiveLogsMock.mockRejectedValueOnce(error);
      },
    },
    {
      label: "active customers",
      rejectRead: (error: Error) => {
        listActiveCustomerSnapshotsMock.mockRejectedValueOnce(error);
      },
    },
    {
      label: "uncharged reports",
      rejectRead: (error: Error) => {
        getUnchargedReportsMock.mockRejectedValueOnce(error);
      },
    },
  ])("$label rejectionを同じError instanceで透過し、全readを1回だけ開始する", async ({
    rejectRead,
  }) => {
    const failure = new Error("source read failed");
    rejectRead(failure);

    await expect(fetchStaffDashboardSourceData()).rejects.toBe(failure);

    expect(getActiveLogsMock).toHaveBeenCalledTimes(1);
    expect(listActiveCustomerSnapshotsMock).toHaveBeenCalledTimes(1);
    expect(getUnchargedReportsMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchStaffDashboardLogHistory", () => {
  it("exact root IDで全結果を取得し、missing revisionを0として昇順sortする", async () => {
    const revisionThree = {
      id: "revision-3",
      tankId: "A-01",
      action: "貸出",
      logStatus: "voided",
      revision: 3,
    } satisfies DashboardLogEntry;
    const missingRevision = {
      id: "revision-missing",
      tankId: "A-01",
      action: "貸出",
      logStatus: "active",
    } satisfies DashboardLogEntry;
    const revisionOne = {
      id: "revision-1",
      tankId: "A-01",
      action: "貸出",
      logStatus: "superseded",
      revision: 1,
    } satisfies DashboardLogEntry;
    const revisionZero = {
      id: "revision-0",
      tankId: "A-01",
      action: "貸出",
      logStatus: "superseded",
      revision: 0,
    } satisfies DashboardLogEntry;
    const sourceEntries = [
      revisionThree,
      missingRevision,
      revisionOne,
      revisionZero,
    ];
    getLogsByRootMock.mockResolvedValueOnce(
      sourceEntries as unknown as LogDoc[],
    );

    const result = await fetchStaffDashboardLogHistory(" root-001 ");

    expect(getLogsByRootMock.mock.calls).toStrictEqual([
      [" root-001 "],
    ]);
    expect(result).toBe(sourceEntries);
    expect(result).toStrictEqual([
      missingRevision,
      revisionZero,
      revisionOne,
      revisionThree,
    ]);
    expect(result.map((entry) => entry.logStatus)).toStrictEqual([
      "active",
      "superseded",
      "superseded",
      "voided",
    ]);
    expect(result).toContain(revisionThree);
    expect(result).toContain(missingRevision);
    expect(result).toContain(revisionOne);
    expect(result).toContain(revisionZero);
  });

  it("empty root IDもguardやtrimを追加せずrepositoryへ渡す", async () => {
    await fetchStaffDashboardLogHistory("");

    expect(getLogsByRootMock.mock.calls).toStrictEqual([[""]]);
  });

  it("history rejectionを同じError instanceで透過する", async () => {
    const failure = new Error("history read failed");
    getLogsByRootMock.mockRejectedValueOnce(failure);

    await expect(
      fetchStaffDashboardLogHistory("root-002"),
    ).rejects.toBe(failure);
    expect(getLogsByRootMock.mock.calls).toStrictEqual([
      ["root-002"],
    ]);
  });
});

describe("page today memo source equivalence", () => {
  it("todayInputsとdashboardReadModelの2段memo・capture・dependencyをexactに固定する", () => {
    const pagePath = "src/app/staff/dashboard/page.tsx";
    const todayInputsInitializer = getVariableInitializerText(
      pagePath,
      "todayInputs",
    );
    const dashboardReadModelInitializer = getVariableInitializerText(
      pagePath,
      "dashboardReadModel",
    );

    expect(todayInputsInitializer).toBe([
      "useMemo(() => ({",
      "    logs,",
      "    staffLocale,",
      "    nowMillis: new Date().getTime(),",
      "}), [logs, staffLocale])",
    ].join("\n"));
    expect(todayInputsInitializer).not.toContain("Date.now");

    expect(dashboardReadModelInitializer).toBe([
      "useMemo(() => buildStaffDashboardReadModel({",
      "    tanks,",
      "    logs: todayInputs.logs,",
      "    customerOptions,",
      "    unfilledReports,",
      "    staffLocale: todayInputs.staffLocale,",
      "    nowMillis: todayInputs.nowMillis,",
      "}), [tanks, customerOptions, unfilledReports, todayInputs])",
    ].join("\n"));
  });
});

function getVariableInitializerText(
  relativePath: string,
  variableName: string,
): string {
  const absolutePath = resolve(process.cwd(), relativePath);
  const sourceText = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const declaration = findVariableDeclaration(
    sourceFile,
    variableName,
  );

  if (!declaration?.initializer) {
    throw new Error(`${relativePath}: ${variableName} が見つかりません`);
  }

  return ts.createPrinter({
    removeComments: true,
  }).printNode(
    ts.EmitHint.Unspecified,
    declaration.initializer,
    sourceFile,
  );
}

function findVariableDeclaration(
  node: ts.Node,
  variableName: string,
): ts.VariableDeclaration | undefined {
  if (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === variableName
  ) {
    return node;
  }

  let found: ts.VariableDeclaration | undefined;
  ts.forEachChild(node, (child) => {
    if (!found) {
      found = findVariableDeclaration(child, variableName);
    }
  });
  return found;
}
