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
  updateBulkReturnTagMarker,
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
const updateBulkReturnTagMarkerMock = vi.mocked(updateBulkReturnTagMarker);

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

function HookHarness(
  tanks: BulkTankWithTag[],
  metaOverrides: Partial<BulkReturnGroupMeta> = {},
) {
  const bulkLoadingSetter = vi.fn();
  const groupedTanksSetter = vi.fn();
  const groupMetaSetter = vi.fn();
  const expandedSetter = vi.fn();
  const returningSetter = vi.fn();
  const bulkLoadFailedSetter = vi.fn();
  const meta = {
    key: "customer-001",
    location: "顧客A",
    customerId: "customer-001",
    pool: "today_lent",
    poolLabel: "本日貸出",
    dateLabel: "7/30 貸出分",
    sortMillis: 1,
    ...metaOverrides,
  } satisfies BulkReturnGroupMeta;

  useStateMock
    .mockImplementationOnce(() => [false, bulkLoadingSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: tanks }, groupedTanksSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: meta }, groupMetaSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: true }, expandedSetter])
    .mockImplementationOnce(() => [{ [GROUP_KEY]: false }, returningSetter])
    .mockImplementationOnce(() => [false, bulkLoadFailedSetter]);

  return {
    result: useBulkReturnByLocation(),
    bulkLoadingSetter,
    groupedTanksSetter,
    groupMetaSetter,
    expandedSetter,
    returningSetter,
    bulkLoadFailedSetter,
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
    updateBulkReturnTagMarkerMock.mockReset();
    updateBulkReturnTagMarkerMock.mockResolvedValue();
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
    expect(confirm).toHaveBeenCalledWith(
      "顧客A（本日貸出） のタンク全 2 本を一括返却しますか？\n(タグ付けに応じて処理されます)",
    );
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
    expect(alert).toHaveBeenCalledWith(
      "顧客A（本日貸出） の一括返却が完了しました。",
    );
  });

  it("英語 locale で表示文言だけを変えraw fallbackLocation・配列・call countを維持する", async () => {
    localeState.current = "en";
    const tanks = [makeTank("EN-READY-01")];
    const { result, returningSetter } = HookHarness(tanks);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(confirm).mock.calls[0][0])).toContain("Bulk return all 1 tank");
    expect(String(vi.mocked(confirm).mock.calls[0][0])).toContain("Rented today");
    expect(String(vi.mocked(confirm).mock.calls[0][0])).not.toContain("本日貸出");
    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(submitBulkReturnGroupMock).toHaveBeenCalledTimes(1);
    expect(submitBulkReturnGroupMock.mock.calls[0][0]).toEqual({
      tanks,
      fallbackLocation: "顧客A",
      actor: ACTOR,
    });
    expect(returningSetter).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(alert).mock.calls[0][0])).toContain("Bulk return is complete");
    expect(fetchBulkReturnCandidatesMock).toHaveBeenCalledTimes(1);
  });

  it("英語 locale でsystem-generated unknown customerだけを表示変換しraw fallbackを保存する", async () => {
    localeState.current = "en";
    const tanks = [makeTank("EN-UNKNOWN-01", {
      customerId: "missing-name",
      customerName: null,
      location: "",
    })];
    const { result } = HookHarness(tanks, {
      key: "today_lent::customer:missing-name",
      customerId: "missing-name",
      location: "不明な顧客",
    });

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(String(vi.mocked(confirm).mock.calls[0][0])).toContain("Unknown customer");
    expect(String(vi.mocked(confirm).mock.calls[0][0])).not.toContain("不明な顧客");
    expect(submitBulkReturnGroupMock.mock.calls[0][0].fallbackLocation).toBe("不明な顧客");
  });

  it("英語 locale の持ち越し確認・完了は単数形を使いraw payloadを変えない", async () => {
    localeState.current = "en";
    const tanks = [
      makeTank("EN-RETURN-01"),
      makeTank("EN-KEEP-01", { tag: "keep" }),
    ];
    const { result } = HookHarness(tanks);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    const confirmation = String(vi.mocked(confirm).mock.calls[0][0]);
    const completion = String(vi.mocked(alert).mock.calls[0][0]);
    expect(confirmation).toContain("Return: 1 tank / Carry over: 1 tank");
    expect(completion).toContain("Return: 1 tank / Carry over: 1 tank");
    expect(submitBulkReturnGroupMock.mock.calls[0][0].tanks).toBe(tanks);
    expect(submitBulkReturnGroupMock.mock.calls[0][0].fallbackLocation).toBe("顧客A");
  });

  it("英語 locale でinvalid KEEPをlocalized alertでsubmit前に停止する", async () => {
    localeState.current = "en";
    const tanks = [makeTank("EN-INVALID-KEEP", {
      status: "unreturned",
      tag: "keep",
    })];
    const { result, returningSetter } = HookHarness(tanks);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(alert).toHaveBeenCalledWith(
      "Carry over can only be processed for rented tanks. Remove carry over from unreturned tanks.",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(requireStaffIdentityMock).not.toHaveBeenCalled();
    expect(submitBulkReturnGroupMock).not.toHaveBeenCalled();
    expect(returningSetter).not.toHaveBeenCalled();
  });

  it("英語 locale でinvalid KEEP tag選択をmarker write前に停止する", async () => {
    localeState.current = "en";
    const tanks = [makeTank("EN-INVALID-TAG", { status: "unreturned" })];
    const { result } = HookHarness(tanks);

    await result.updateTag(GROUP_KEY, "EN-INVALID-TAG", "keep");

    expect(alert).toHaveBeenCalledWith(
      "Carry over can only be selected for rented tanks.",
    );
    expect(updateBulkReturnTagMarkerMock).not.toHaveBeenCalled();
    expect(fetchBulkReturnCandidatesMock).not.toHaveBeenCalled();
  });

  it("confirm取消はidentity・submit・returning・refreshを開始しない", async () => {
    vi.mocked(confirm).mockReturnValueOnce(false);
    const { result, returningSetter } = HookHarness([makeTank("CANCEL-01")]);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(requireStaffIdentityMock).not.toHaveBeenCalled();
    expect(submitBulkReturnGroupMock).not.toHaveBeenCalled();
    expect(returningSetter).not.toHaveBeenCalled();
    expect(fetchBulkReturnCandidatesMock).not.toHaveBeenCalled();
  });

  it("英語 locale のunknown failureはraw errorをlogに保持しUIに露出しない", async () => {
    localeState.current = "en";
    const rawError = new Error("内部エラー: customerId=secret");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    submitBulkReturnGroupMock.mockRejectedValueOnce(rawError);
    const { result } = HookHarness([makeTank("EN-ERROR-01")]);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(consoleError).toHaveBeenCalledWith("Bulk return failed", rawError);
    expect(alert).toHaveBeenCalledWith(
      "The operation failed. Please try again later.",
    );
    expect(String(vi.mocked(alert).mock.calls[0][0])).not.toContain("customerId");
    expect(String(vi.mocked(alert).mock.calls[0][0])).not.toContain("内部エラー");
    expect(fetchBulkReturnCandidatesMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("日本語 locale のunknown failureは従来どおりraw errorを表示する", async () => {
    const rawError = new Error("業務エラー");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    submitBulkReturnGroupMock.mockRejectedValueOnce(rawError);
    const { result } = HookHarness([makeTank("JA-ERROR-01")]);

    await result.handleBulkReturnForGroup(GROUP_KEY);

    expect(alert).toHaveBeenCalledWith("エラー: 業務エラー");
    expect(fetchBulkReturnCandidatesMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("候補取得失敗をloadFailedへ分離しloadingを必ず終了する", async () => {
    const rawError = new Error("read failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchBulkReturnCandidatesMock.mockRejectedValueOnce(rawError);
    const {
      result,
      bulkLoadingSetter,
      groupedTanksSetter,
      groupMetaSetter,
      expandedSetter,
      bulkLoadFailedSetter,
    } = HookHarness([makeTank("LOAD-ERROR-01")]);

    await result.fetchBulkTanks();

    expect(bulkLoadingSetter.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(bulkLoadFailedSetter.mock.calls.map(([value]) => value)).toEqual([false, true]);
    expect(groupedTanksSetter).not.toHaveBeenCalled();
    expect(groupMetaSetter).not.toHaveBeenCalled();
    expect(expandedSetter).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(rawError);
    consoleError.mockRestore();
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
