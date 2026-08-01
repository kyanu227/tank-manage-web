import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  TransitionPlanRequest,
  TransitionPlanResult,
} from "@/lib/tank-transition-policy";
import type { OperationActor } from "@/lib/operation-context";
import {
  applyBulkTankOperations,
  applyTankOperation,
  StaleTankCycleError,
  type ExpectedTankCycle,
  type StaleTankCycleIssue,
  type TankOperationInput,
} from "@/lib/tank-operation";

type PlanTankTransition = (
  request: TransitionPlanRequest,
) => TransitionPlanResult;

type MockReference = {
  id: string;
  path: string;
};

type MockSnapshot = {
  exists: () => boolean;
  data: () => Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  db: { kind: "mock-db" },
  collection: vi.fn(),
  deleteField: vi.fn(),
  doc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  getTankOperationPolicyInTransaction: vi.fn(),
  planTankTransition: vi.fn(),
  resolvePlannerPolicyMode: vi.fn(),
  createRecoveryConfirmationFingerprint: vi.fn(),
  actualPlanTankTransition: null as PlanTankTransition | null,
  actualResolvePlannerPolicyMode: null as (
    typeof import("@/lib/tank-transition-policy")
  )["resolvePlannerPolicyMode"] | null,
  staffLocale: "ja" as "ja" | "en",
  aggregationReference: {
    id: "tankAggregationRevision",
    path: "settings/tankAggregationRevision",
  },
}));

vi.mock("firebase/firestore", () => ({
  collection: mocks.collection,
  deleteField: mocks.deleteField,
  doc: mocks.doc,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock("@/lib/firebase/config", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/firebase/tank-operation-policy-service", () => ({
  getTankOperationPolicyInTransaction:
    mocks.getTankOperationPolicyInTransaction,
}));

vi.mock("@/lib/firebase/tank-aggregation-revision-service", () => ({
  getTankAggregationRevisionRef: () => mocks.aggregationReference,
  normalizeTankAggregationRevisions: () => ({
    tankDataRevision: 0,
    officialAggregationRevision: 0,
  }),
  nextTankAggregationRevisions: () => ({
    tankDataRevision: 1,
    officialAggregationRevision: 1,
  }),
}));

vi.mock("@/hooks/useStaffSession", () => ({
  getStaffLocale: () => mocks.staffLocale,
}));

vi.mock("@/lib/tank-transition-policy", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/tank-transition-policy")
  >();
  mocks.actualPlanTankTransition = actual.planTankTransition;
  mocks.actualResolvePlannerPolicyMode = actual.resolvePlannerPolicyMode;
  mocks.planTankTransition.mockImplementation(actual.planTankTransition);
  mocks.resolvePlannerPolicyMode.mockImplementation(
    actual.resolvePlannerPolicyMode,
  );
  return {
    ...actual,
    planTankTransition: mocks.planTankTransition,
    resolvePlannerPolicyMode: mocks.resolvePlannerPolicyMode,
    createRecoveryConfirmationFingerprint:
      mocks.createRecoveryConfirmationFingerprint,
  };
});

const ACTOR = {
  staffId: "staff-001",
  staffName: "山田 太郎",
  staffEmail: "yamada@example.com",
} satisfies OperationActor;

const EXPECTED_CYCLE = {
  customerId: "customer-001",
  latestLogId: "log-001",
} satisfies ExpectedTankCycle;

let tankAttempts: Array<Record<string, Record<string, unknown>>>;
let recordedTransactions: Array<{
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}>;
let transactionCallbackCount: number;
let logSequence: number;

function tankData(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "lent",
    customerId: "customer-001",
    customerName: "顧客A",
    latestLogId: "log-001",
    location: "顧客A",
    staff: "担当者A",
    logNote: "",
    ...overrides,
  };
}

function operationInput(
  overrides: Partial<TankOperationInput> = {},
): TankOperationInput {
  return {
    tankId: "T001",
    transitionAction: "return",
    context: {
      actor: ACTOR,
      source: "bulk_return",
      workflow: "tank_operation",
    },
    location: "倉庫",
    ...overrides,
  };
}

function runtimeExpectedCycle(value: unknown): ExpectedTankCycle {
  return value as ExpectedTankCycle;
}

function setTankAttempts(
  ...attempts: Array<Record<string, Record<string, unknown>>>
): void {
  tankAttempts = attempts;
}

function referencePath(reference: unknown): string {
  if (
    typeof reference === "object"
    && reference !== null
    && "path" in reference
    && typeof reference.path === "string"
  ) {
    return reference.path;
  }
  return "";
}

function snapshot(
  data: Record<string, unknown> | undefined,
): MockSnapshot {
  return {
    exists: () => data !== undefined,
    data: () => data ?? {},
  };
}

function createRecordedTransaction(
  tankState: Record<string, Record<string, unknown>>,
): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(async (reference: unknown) => {
      const path = referencePath(reference);
      if (path === mocks.aggregationReference.path) return snapshot(undefined);
      if (path.startsWith("tanks/")) {
        return snapshot(tankState[path.slice("tanks/".length)]);
      }
      return snapshot(undefined);
    }),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function requireStaleError(
  error: unknown,
  issues: readonly StaleTankCycleIssue[],
): StaleTankCycleError {
  expect(error).toBeInstanceOf(StaleTankCycleError);
  if (!(error instanceof StaleTankCycleError)) {
    throw new Error("StaleTankCycleError が返りませんでした");
  }
  expect(error.name).toBe("StaleTankCycleError");
  expect(error.code).toBe("stale_tank_cycle");
  expect(error.issues).toEqual(issues);
  error.issues.forEach((issue, index) => {
    expect(issue.tankId).toBe(issues[index]?.tankId);
    expect(issue.field).toBe(issues[index]?.field);
    expect(issue.reason).toBe(issues[index]?.reason);
  });
  return error;
}

function expectNoWrites(
  transaction: (typeof recordedTransactions)[number],
): void {
  expect(transaction.set).toHaveBeenCalledTimes(0);
  expect(transaction.update).toHaveBeenCalledTimes(0);
  expect(transaction.delete).toHaveBeenCalledTimes(0);
}

beforeEach(() => {
  tankAttempts = [{ T001: tankData() }];
  recordedTransactions = [];
  transactionCallbackCount = 0;
  logSequence = 0;
  mocks.staffLocale = "ja";

  mocks.collection.mockReset();
  mocks.collection.mockImplementation(
    (_database: unknown, collectionName: string) => ({
      id: collectionName,
      path: collectionName,
    }),
  );
  mocks.doc.mockReset();
  mocks.doc.mockImplementation(
    (base: unknown, ...segments: string[]): MockReference => {
      if (segments.length === 0) {
        logSequence += 1;
        return {
          id: `generated-log-${logSequence}`,
          path: `${referencePath(base)}/generated-log-${logSequence}`,
        };
      }
      return {
        id: segments.at(-1) ?? "",
        path: segments.join("/"),
      };
    },
  );
  mocks.deleteField.mockReset();
  mocks.deleteField.mockReturnValue({ kind: "delete-field" });
  mocks.serverTimestamp.mockReset();
  mocks.serverTimestamp.mockReturnValue({ kind: "server-timestamp" });
  mocks.getTankOperationPolicyInTransaction.mockReset();
  mocks.getTankOperationPolicyInTransaction.mockResolvedValue({
    transitionEnforcement: "strict",
    policyRevision: 1,
  });
  mocks.createRecoveryConfirmationFingerprint.mockReset();
  mocks.createRecoveryConfirmationFingerprint.mockResolvedValue("a".repeat(64));

  mocks.planTankTransition.mockReset();
  if (mocks.actualPlanTankTransition) {
    mocks.planTankTransition.mockImplementation(
      mocks.actualPlanTankTransition,
    );
  }
  mocks.resolvePlannerPolicyMode.mockReset();
  if (mocks.actualResolvePlannerPolicyMode) {
    mocks.resolvePlannerPolicyMode.mockImplementation(
      mocks.actualResolvePlannerPolicyMode,
    );
  }

  mocks.runTransaction.mockReset();
  mocks.runTransaction.mockImplementation(
    async (
      _database: unknown,
      callback: (
        transaction: ReturnType<typeof createRecordedTransaction>,
      ) => Promise<unknown>,
    ) => {
      const attemptIndex = transactionCallbackCount;
      transactionCallbackCount += 1;
      const attemptState = tankAttempts[attemptIndex]
        ?? tankAttempts.at(-1)
        ?? {};
      const transaction = createRecordedTransaction(attemptState);
      recordedTransactions.push(transaction);
      return callback(transaction);
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tank cycle guard", () => {
  it("#1 expectedCycle未指定の正常系は従来どおりwriteする", async () => {
    const result = await applyTankOperation(operationInput());

    expect(result).toMatchObject({
      tankId: "T001",
      nextStatus: "empty",
      logId: "generated-log-1",
    });
    expect(transactionCallbackCount).toBe(1);
    expect(recordedTransactions[0]?.set).toHaveBeenCalledTimes(2);
    expect(recordedTransactions[0]?.update).toHaveBeenCalledTimes(1);

    const logWrite = recordedTransactions[0]?.set.mock.calls.find(
      ([reference]) => referencePath(reference).startsWith("logs/"),
    );
    const logData = logWrite?.[1] as Record<string, unknown> | undefined;
    expect(logData?.prevTankSnapshot).toEqual({
      status: "lent",
      customerId: "customer-001",
      customerName: "顧客A",
      location: "顧客A",
      staff: "担当者A",
      logNote: "",
    });
    expect(logData?.prevTankSnapshot).not.toHaveProperty("latestLogId");
    expect(logData?.nextTankSnapshot).not.toHaveProperty("latestLogId");
  });

  it("#2 両field一致なら実行され、planner spyの接続も確認できる", async () => {
    await applyTankOperation(operationInput({
      expectedCycle: EXPECTED_CYCLE,
    }));

    expect(transactionCallbackCount).toBe(1);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(1);
    expect(recordedTransactions[0]?.set).toHaveBeenCalledTimes(2);
    expect(recordedTransactions[0]?.update).toHaveBeenCalledTimes(1);
  });

  const staleCases: Array<{
    name: string;
    current: Record<string, unknown>;
    expected: unknown;
    issues: readonly StaleTankCycleIssue[];
  }> = [
    {
      name: "#3 customerIdのみ不一致",
      current: tankData({ customerId: "customer-current" }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "mismatch",
      }],
    },
    {
      name: "#4 latestLogIdのみ不一致の同一顧客ABA",
      current: tankData({ latestLogId: "log-current" }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "latestLogId",
        reason: "mismatch",
      }],
    },
    {
      name: "#5/#23 両field不一致",
      current: tankData({
        customerId: "customer-current",
        latestLogId: "log-current",
      }),
      expected: EXPECTED_CYCLE,
      issues: [
        {
          tankId: "T001",
          field: "customerId",
          reason: "mismatch",
        },
        {
          tankId: "T001",
          field: "latestLogId",
          reason: "mismatch",
        },
      ],
    },
    {
      name: "#6 current null / expected string",
      current: tankData({ customerId: null }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_current",
      }],
    },
    {
      name: "#6 current string / runtime expected null",
      current: tankData(),
      expected: {
        customerId: null,
        latestLogId: "log-001",
      },
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_expected",
      }],
    },
    {
      name: "#7 legacy current undefined",
      current: tankData({ customerId: undefined }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_current",
      }],
    },
    {
      name: "#8 current空文字をsilent skipしない",
      current: tankData({ customerId: "" }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_current",
      }],
    },
    {
      name: "#8 current空白をsilent skipしない",
      current: tankData({ latestLogId: "   " }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "latestLogId",
        reason: "missing_current",
      }],
    },
    {
      name: "#8 runtime expected空白をsilent skipしない",
      current: tankData(),
      expected: {
        customerId: "   ",
        latestLogId: "log-001",
      },
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_expected",
      }],
    },
    {
      name: "#8 currentとexpectedが両方不正ならmissing_currentを優先する",
      current: tankData({ customerId: null }),
      expected: {
        customerId: null,
        latestLogId: "log-001",
      },
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_current",
      }],
    },
    {
      name: "#8a current customerId数値は文字列化しない",
      current: tankData({ customerId: 123 }),
      expected: {
        customerId: "123",
        latestLogId: "log-001",
      },
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_current",
      }],
    },
    {
      name: "#8b current latestLogId数値は文字列化しない",
      current: tankData({ latestLogId: 123 }),
      expected: {
        customerId: "customer-001",
        latestLogId: "123",
      },
      issues: [{
        tankId: "T001",
        field: "latestLogId",
        reason: "missing_current",
      }],
    },
    {
      name: "#8c runtime expected数値はmissing_expected",
      current: tankData({ customerId: "123" }),
      expected: {
        customerId: 123,
        latestLogId: "log-001",
      },
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "missing_expected",
      }],
    },
    {
      name: "#8d current customerIdをtrim比較しない",
      current: tankData({ customerId: " customer-001 " }),
      expected: EXPECTED_CYCLE,
      issues: [{
        tankId: "T001",
        field: "customerId",
        reason: "mismatch",
      }],
    },
    {
      name: "#8e expected latestLogIdをtrim比較しない",
      current: tankData(),
      expected: {
        customerId: "customer-001",
        latestLogId: " log-001 ",
      },
      issues: [{
        tankId: "T001",
        field: "latestLogId",
        reason: "mismatch",
      }],
    },
    {
      name: "#9 runtime expectedCycle片field欠落",
      current: tankData(),
      expected: {
        customerId: "customer-001",
      },
      issues: [{
        tankId: "T001",
        field: "latestLogId",
        reason: "missing_expected",
      }],
    },
  ];

  it.each(staleCases)("$name", async ({ current, expected, issues }) => {
    setTankAttempts({ T001: current });

    const error = await captureError(applyTankOperation(operationInput({
      expectedCycle: runtimeExpectedCycle(expected),
    })));

    requireStaleError(error, issues);
    expect(transactionCallbackCount).toBe(1);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(0);
    const transaction = recordedTransactions[0];
    if (!transaction) throw new Error("transaction callback が実行されませんでした");
    expectNoWrites(transaction);
  });

  it("#10 stale attemptではplanner/writer/extraOpsがすべて0", async () => {
    const extraOps = vi.fn();
    setTankAttempts({
      T001: tankData({ latestLogId: "log-new" }),
    });

    const error = await captureError(applyBulkTankOperations([
      operationInput({ expectedCycle: EXPECTED_CYCLE }),
    ], extraOps));

    requireStaleError(error, [{
      tankId: "T001",
      field: "latestLogId",
      reason: "mismatch",
    }]);
    expect(transactionCallbackCount).toBe(1);
    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(0);
    expect(extraOps).toHaveBeenCalledTimes(0);
    const transaction = recordedTransactions[0];
    if (!transaction) throw new Error("transaction callback が実行されませんでした");
    expectNoWrites(transaction);
  });

  it("#11 statusもcycleも変化した場合はcycle errorを先に返す", async () => {
    setTankAttempts({
      T001: tankData({
        status: "filled",
        latestLogId: "log-new",
      }),
    });

    const error = await captureError(applyTankOperation(operationInput({
      expectedCycle: EXPECTED_CYCLE,
    })));

    requireStaleError(error, [{
      tankId: "T001",
      field: "latestLogId",
      reason: "mismatch",
    }]);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(0);
  });

  it("#12 stale errorはrecovery retry loopへ入らない", async () => {
    const confirm = vi.fn<(message: string) => boolean>(() => true);
    vi.stubGlobal("window", { confirm });
    setTankAttempts({
      T001: tankData({ latestLogId: "log-new" }),
    });

    const error = await captureError(applyTankOperation(operationInput({
      expectedCycle: EXPECTED_CYCLE,
    })));

    requireStaleError(error, [{
      tankId: "T001",
      field: "latestLogId",
      reason: "mismatch",
    }]);
    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCallbackCount).toBe(1);
    expect(confirm).toHaveBeenCalledTimes(0);
  });

  it("#13 recovery確認中にcycleが変化したら再確認せずstaleにする", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    mocks.resolvePlannerPolicyMode.mockReturnValue("advisory");
    setTankAttempts(
      {
        T001: tankData({
          status: "empty",
          customerId: "customer-001",
          latestLogId: "log-001",
        }),
      },
      {
        T001: tankData({
          status: "empty",
          customerId: "customer-001",
          latestLogId: "log-002",
        }),
      },
    );

    const error = await captureError(applyTankOperation(operationInput({
      transitionAction: "lend",
      context: {
        actor: ACTOR,
        customer: {
          customerId: "customer-002",
          customerName: "顧客B",
        },
        source: "manual",
        workflow: "tank_operation",
      },
      location: "顧客B",
      expectedCycle: EXPECTED_CYCLE,
    })));

    requireStaleError(error, [{
      tankId: "T001",
      field: "latestLogId",
      reason: "mismatch",
    }]);
    expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
    expect(transactionCallbackCount).toBe(2);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    recordedTransactions.forEach(expectNoWrites);
  });

  it.each(["ja", "en"] as const)("recovery確認は%s表示でもretry・write契約を維持する", async (locale) => {
    mocks.staffLocale = locale;
    const confirm = vi.fn<(message: string) => boolean>(() => true);
    vi.stubGlobal("window", { confirm });
    mocks.resolvePlannerPolicyMode.mockReturnValue("advisory");
    const current = tankData({
      status: "empty",
      customerId: "customer-001",
      customerName: "Customer A",
      location: "Customer A",
    });
    setTankAttempts({ T001: current }, { T001: current });

    const result = await applyTankOperation(operationInput({
      transitionAction: "lend",
      context: {
        actor: ACTOR,
        customer: {
          customerId: "customer-002",
          customerName: "Customer B",
        },
        source: "manual",
        workflow: "tank_operation",
      },
      location: "Customer B",
    }));

    expect(result.nextStatus).toBe("lent");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
    expect(transactionCallbackCount).toBe(2);
    expectNoWrites(recordedTransactions[0]!);
    expect(recordedTransactions[1]?.set).toHaveBeenCalledTimes(2);
    expect(recordedTransactions[1]?.update).toHaveBeenCalledTimes(1);
    const prompt = String(confirm.mock.calls[0]?.[0]);
    if (locale === "en") {
      expect(prompt).toContain("Run state-transition recovery (1/1).");
      expect(prompt).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff々〆〤ヶ]/u);
    } else {
      expect(prompt).toContain("状態遷移の自動補完を実行します（1/1）。");
    }
    const logWrite = recordedTransactions[1]?.set.mock.calls.find(
      ([reference]) => referencePath(reference).startsWith("logs/"),
    );
    const logData = logWrite?.[1] as Record<string, unknown> | undefined;
    expect(logData?.recoveryConfirmationFingerprint).toBe("a".repeat(64));
    expect(logData?.recoveryEvidence).toEqual({
      physicalTankConfirmed: true,
      fillStateConfirmed: true,
    });
  });

  it.each(["ja", "en"] as const)("recovery確認を%s表示でcancelするとwriteせずretryしない", async (locale) => {
    mocks.staffLocale = locale;
    const confirm = vi.fn<(message: string) => boolean>(() => false);
    vi.stubGlobal("window", { confirm });
    mocks.resolvePlannerPolicyMode.mockReturnValue("advisory");
    setTankAttempts({
      T001: tankData({
        status: "empty",
        customerId: "customer-001",
        customerName: "Customer A",
        location: "Customer A",
      }),
    });

    const error = await captureError(applyTankOperation(operationInput({
      transitionAction: "lend",
      context: {
        actor: ACTOR,
        customer: {
          customerId: "customer-002",
          customerName: "Customer B",
        },
        source: "manual",
        workflow: "tank_operation",
      },
      location: "Customer B",
    })));

    expect(error).toEqual(new Error(locale === "ja"
      ? "自動補完操作をキャンセルしました。"
      : "The recovery operation was cancelled."));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expectNoWrites(recordedTransactions[0]!);
  });

  it("#19 valid先頭・stale後続でも全cycle検査前にplannerを呼ばない", async () => {
    const extraOps = vi.fn();
    setTankAttempts({
      T001: tankData(),
      T002: tankData({ latestLogId: "log-new" }),
    });

    const error = await captureError(applyBulkTankOperations([
      operationInput({
        tankId: "T001",
        expectedCycle: EXPECTED_CYCLE,
      }),
      operationInput({
        tankId: "T002",
        expectedCycle: EXPECTED_CYCLE,
      }),
    ], extraOps));

    requireStaleError(error, [{
      tankId: "T002",
      field: "latestLogId",
      reason: "mismatch",
    }]);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(0);
    expect(extraOps).toHaveBeenCalledTimes(0);
    const transaction = recordedTransactions[0];
    if (!transaction) throw new Error("transaction callback が実行されませんでした");
    expectNoWrites(transaction);
  });

  it("#20/#21/#22 2 tankの全issueを入力順・field順で集約する", async () => {
    setTankAttempts({
      T001: tankData({
        customerId: "customer-new-1",
        latestLogId: "log-new-1",
      }),
      T002: tankData({
        customerId: "customer-new-2",
        latestLogId: "log-new-2",
      }),
    });
    const expectedIssues = [
      {
        tankId: "T001",
        field: "customerId",
        reason: "mismatch",
      },
      {
        tankId: "T001",
        field: "latestLogId",
        reason: "mismatch",
      },
      {
        tankId: "T002",
        field: "customerId",
        reason: "mismatch",
      },
      {
        tankId: "T002",
        field: "latestLogId",
        reason: "mismatch",
      },
    ] satisfies StaleTankCycleIssue[];

    const error = await captureError(applyBulkTankOperations([
      operationInput({
        tankId: "T001",
        expectedCycle: EXPECTED_CYCLE,
      }),
      operationInput({
        tankId: "T002",
        expectedCycle: EXPECTED_CYCLE,
      }),
    ]));

    const stale = requireStaleError(error, expectedIssues);
    expect(stale.code).toBe("stale_tank_cycle");
    expect(stale.issues).toHaveLength(4);
    expect(mocks.planTankTransition).toHaveBeenCalledTimes(0);
  });
});

describe("carry_over customer projection compatibility", () => {
  const CUSTOMER = {
    customerId: "customer-001",
    customerName: "顧客A",
  };

  const carryOverCases: Array<{
    name: string;
    previous: Record<string, unknown>;
    expectedProjection?: {
      customerId: string | null;
      customerName: string | null;
    };
    errorMessage?: string;
  }> = [
    {
      name: "c1 完全なpreviousと同一customer",
      previous: {
        customerId: "customer-001",
        customerName: "顧客A",
      },
      expectedProjection: CUSTOMER,
    },
    {
      name: "c2/#14 完全なpreviousと異なるcustomer",
      previous: {
        customerId: "customer-other",
        customerName: "顧客B",
      },
      errorMessage: "持ち越し操作の顧客情報が現在貸出先と一致しません",
    },
    {
      name: "c3 previous両field欠落はcontextを採用",
      previous: {
        customerId: undefined,
        customerName: undefined,
      },
      expectedProjection: CUSTOMER,
    },
    {
      name: "c4 null projectionはそのまま返す",
      previous: {
        customerId: null,
        customerName: null,
      },
      expectedProjection: {
        customerId: null,
        customerName: null,
      },
    },
    {
      name: "c5 customerId null / customerName undefinedを拒否",
      previous: {
        customerId: null,
        customerName: undefined,
      },
      errorMessage: "持ち越し前の顧客projectionが不正です",
    },
    {
      name: "c5 customerId null / customerName stringを拒否",
      previous: {
        customerId: null,
        customerName: "顧客A",
      },
      errorMessage: "持ち越し前の顧客projectionが不正です",
    },
    {
      name: "c6 customerId undefined / matching nameを補完",
      previous: {
        customerId: undefined,
        customerName: "顧客A",
      },
      expectedProjection: CUSTOMER,
    },
    {
      name: "c7 空白field / matching contextを補完",
      previous: {
        customerId: "   ",
        customerName: "顧客A",
      },
      expectedProjection: CUSTOMER,
    },
    {
      name: "c8 partialの既存値不一致を拒否",
      previous: {
        customerId: "customer-other",
        customerName: undefined,
      },
      errorMessage: "持ち越し前の顧客projectionが不正です",
    },
  ];

  it.each(carryOverCases)(
    "$name",
    async ({ previous, expectedProjection, errorMessage }) => {
      setTankAttempts({
        T001: tankData(previous),
      });
      const promise = applyTankOperation(operationInput({
        transitionAction: "carry_over",
        context: {
          actor: ACTOR,
          customer: CUSTOMER,
          source: "manual",
          workflow: "tank_operation",
        },
      }));

      if (errorMessage) {
        const error = await captureError(promise);
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
          throw new Error("carry_over error が返りませんでした");
        }
        expect(error.message).toBe(errorMessage);
        expect(error).not.toBeInstanceOf(StaleTankCycleError);
        return;
      }

      await promise;
      const tankUpdate = recordedTransactions[0]?.update.mock.calls[0]?.[1] as
        | Record<string, unknown>
        | undefined;
      expect(tankUpdate).toMatchObject(expectedProjection ?? {});
    },
  );
});
