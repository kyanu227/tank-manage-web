import { useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  requireStaffIdentity,
} from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import type { OperationActor } from "@/lib/operation-context";
import { StaleTankCycleError } from "@/lib/tank-operation";
import {
  fetchBulkReturnCandidates,
} from "../queries/bulk-return-candidates";
import {
  submitBulkReturnGroup,
} from "../services/bulk-return-workflow";
import type { BulkReturnGroupMeta } from "../types";
import type { BulkTankWithTag } from "../queries/bulk-return-candidates";
import { useBulkReturnByLocation } from "./useBulkReturnByLocation";

const localeState = vi.hoisted(() => ({
  current: "ja" as Locale,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: vi.fn(),
  };
});

vi.mock("@/hooks/useStaffSession", () => ({
  requireStaffIdentity: vi.fn(),
  useStaffLocale: () => localeState.current,
}));

vi.mock("@/lib/tank-operation", () => ({
  StaleTankCycleError: class StaleTankCycleError extends Error {
    readonly name = "StaleTankCycleError";
    readonly code = "stale_tank_cycle";

    constructor(
      readonly issues: readonly Readonly<{
        tankId: string;
        field: "customerId" | "latestLogId";
        reason: "missing_current" | "missing_expected" | "mismatch";
      }>[],
    ) {
      super("stale cycle");
    }
  },
}));

vi.mock("../queries/bulk-return-candidates", () => ({
  fetchBulkReturnCandidates: vi.fn(),
  getBulkReturnGroupKeys: vi.fn(
    (groups: Record<string, BulkTankWithTag[]>) => Object.keys(groups),
  ),
}));

vi.mock("../services/bulk-return-workflow", () => ({
  submitBulkReturnGroup: vi.fn(),
  updateBulkReturnTagMarker: vi.fn(),
}));

const GROUP_KEY = "today_lent::customer-001";
const ACTOR = {
  staffId: "staff-001",
  staffName: "担当者A",
} satisfies OperationActor;

const useStateMock = useState as unknown as Mock;
const requireStaffIdentityMock = vi.mocked(requireStaffIdentity);
const fetchBulkReturnCandidatesMock = vi.mocked(fetchBulkReturnCandidates);
const submitBulkReturnGroupMock = vi.mocked(submitBulkReturnGroup);

function makeTank(
  id: string,
  overrides: Partial<BulkTankWithTag> = {},
): BulkTankWithTag {
  return {
    id,
    status: "lent",
    customerId: "customer-001",
    customerName: "顧客A",
    latestLogId: `log-${id}`,
    location: "顧客A",
    staff: "担当者A",
    updatedAt: null,
    tag: "normal",
    ...overrides,
  };
}

function HookHarness(tanks: BulkTankWithTag[]) {
  const bulkLoadingSetter = vi.fn();
  const groupedTanksSetter = vi.fn();
  const groupMetaSetter = vi.fn();
  const expandedSetter = vi.fn();
  const returningSetter = vi.fn();
  const meta = {
    key: "customer-001",
    location: "顧客A",
    customerId: "customer-001",
    pool: "today_lent",
    poolLabel: "本日貸出",
    dateLabel: "7/30 貸出分",
    sortMillis: 1,
  } satisfies BulkReturnGroupMeta;

  useStateMock
    .mockImplementationOnce(() => [false, bulkLoadingSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: tanks }, groupedTanksSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: meta }, groupMetaSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: true }, expandedSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: false }, returningSetter]);

  return {
    result: useBulkReturnByLocation(),
    returningSetter,
  };
}

describe("useBulkReturnByLocation submission guard", () => {
  beforeEach(() => {
    useStateMock.mockReset();
    requireStaffIdentityMock.mockReset();
    requireStaffIdentityMock.mockReturnValue(ACTOR);
    fetchBulkReturnCandidatesMock.mockReset();
    fetchBulkReturnCandidatesMock.mockResolvedValue({
      groupedTanks: {},
      groupMeta: {},
    });
    submitBulkReturnGroupMock.mockReset();
    submitBulkReturnGroupMock.mockResolvedValue();
    localeState.current = "ja";
    vi.stubGlobal("alert", vi.fn());
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      locale: "ja" as const,
      summary: "このグループは一括返却できません",
      field: "顧客ID",
      reload: "再読込して再確認してください",
    },
    {
      locale: "en" as const,
      summary: "This group cannot be returned",
      field: "customer ID",
      reload: "Reload and review the group",
    },
  ])("$locale: not ready は confirm・identity・submit・returning を開始しない", async ({
    locale,
    summary,
    field,
    reload,
  }) => {
    localeState.current = locale;
    const tanks = [
      makeTank("MISSING-01", { customerId: null }),
    ];
    const { result, returningSetter } = HookHarness(tanks);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(confirm).not.toHaveBeenCalled();
    expect(requireStaffIdentityMock).not.toHaveBeenCalled();
    expect(submitBulkReturnGroupMock).not.toHaveBeenCalled();
    expect(returningSetter).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(alert).mock.calls[0][0]).toContain(summary);
    expect(vi.mocked(alert).mock.calls[0][0]).toContain("MISSING-01");
    expect(vi.mocked(alert).mock.calls[0][0]).toContain(field);
    expect(vi.mocked(alert).mock.calls[0][0]).toContain(reload);
  });

  it("ready は未加工の group 全件を従来の confirm・identity・submit 経路へ渡す", async () => {
    const tanks = [
      makeTank("READY-01"),
      makeTank("READY-02", { tag: "unused" }),
    ];
    const { result, returningSetter } = HookHarness(tanks);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(result.groupReadiness[GROUP_KEY]).toEqual({
      ready: true,
      issues: [],
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(submitBulkReturnGroupMock).toHaveBeenCalledTimes(1);
    expect(submitBulkReturnGroupMock.mock.calls[0][0]).toMatchObject({
      fallbackLocation: "顧客A",
      actor: ACTOR,
    });
    expect(submitBulkReturnGroupMock.mock.calls[0][0].tanks).toBe(tanks);
    expect(returningSetter).toHaveBeenCalledTimes(2);
    expect(returningSetter.mock.calls[0][0]({})).toEqual({
      [GROUP_KEY]: true,
    });
    expect(returningSetter.mock.calls[1][0]({ [GROUP_KEY]: true })).toEqual({
      [GROUP_KEY]: false,
    });
  });

  it.each([
    {
      locale: "ja" as const,
      field: "顧客ID",
      reason: "現在のcycle情報が不足",
      secondField: "最新操作ID",
      secondReason: "現在値と操作候補が不一致",
      reload: "再読込して再確認してください",
    },
    {
      locale: "en" as const,
      field: "customer ID",
      reason: "current cycle value is missing",
      secondField: "latest operation ID",
      secondReason: "current and candidate values differ",
      reload: "Reload and review the group",
    },
  ])("$locale: StaleTankCycleError を tank ID 付きの人間向け文言へ変換する", async ({
    locale,
    field,
    reason,
    secondField,
    secondReason,
    reload,
  }) => {
    localeState.current = locale;
    const tanks = [makeTank("STALE-01")];
    submitBulkReturnGroupMock.mockRejectedValueOnce(new StaleTankCycleError([
      {
        tankId: "STALE-01",
        field: "customerId",
        reason: "missing_current",
      },
      {
        tankId: "STALE-01",
        field: "latestLogId",
        reason: "mismatch",
      },
    ]));
    const { result } = HookHarness(tanks);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(alert).toHaveBeenCalledTimes(1);
    const message = String(vi.mocked(alert).mock.calls[0][0]);
    expect(message).toContain("STALE-01");
    expect(message).toContain(field);
    expect(message).toContain(reason);
    expect(message).toContain(secondField);
    expect(message).toContain(secondReason);
    expect(message).toContain(reload);
    expect(message).not.toContain("customerId");
    expect(message).not.toContain("latestLogId");
    expect(message).not.toContain("missing_current");
    expect(message).not.toContain("mismatch");
  });
});
