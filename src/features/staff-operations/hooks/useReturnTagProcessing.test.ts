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
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { confirmPendingReturnRequests } from "@/lib/firebase/return-tag-processing-service";
import type { Locale } from "@/lib/locale";
import type { OperationActor } from "@/lib/operation-context";
import { StaffOperationError } from "@/lib/staff-operation-error";
import type { ReturnConfirmationSelectionMap, ReturnGroup } from "../types";
import { useReturnTagProcessing } from "./useReturnTagProcessing";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useState: vi.fn(),
  };
});

vi.mock("@/hooks/useStaffSession", () => ({
  requireStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/firebase/return-tag-processing-service", () => ({
  confirmPendingReturnRequests: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories", () => ({
  transactionsRepository: {
    getPendingReturnTags: vi.fn(async () => []),
  },
}));

const ACTOR = {
  staffId: "staff-001",
  staffName: "Operator A",
} satisfies OperationActor;

const useStateMock = useState as unknown as Mock;
const requireStaffIdentityMock = vi.mocked(requireStaffIdentity);
const confirmPendingReturnRequestsMock = vi.mocked(confirmPendingReturnRequests);

function createReturnGroup(condition: unknown): ReturnGroup {
  const group: ReturnGroup = {
    customerId: "customer-1",
    customerName: "Ocean Shop",
    items: [{
      id: "return-1",
      customerId: "customer-1",
      customerName: "Ocean Shop",
      tankId: "A-01",
      condition: "unused",
    }],
  };
  (group.items[0] as unknown as { condition: unknown }).condition = condition;
  return group;
}

function createSelections(
  condition: unknown,
  selected = true,
): ReturnConfirmationSelectionMap {
  const selections: ReturnConfirmationSelectionMap = {
    "return-1": { selected, condition: "unused" },
  };
  (selections["return-1"] as unknown as { condition: unknown }).condition = condition;
  return selections;
}

function HookHarness(
  group: ReturnGroup,
  selections: ReturnConfirmationSelectionMap,
  locale: Locale,
) {
  const setReturnConfirmationSubmitting = vi.fn();
  const fetchBulkTanks = vi.fn(async () => undefined);

  useStateMock
    .mockImplementationOnce(() => [true, vi.fn()])
    .mockImplementationOnce(() => [false, vi.fn()])
    .mockImplementationOnce(() => [[group], vi.fn()])
    .mockImplementationOnce(() => [group, vi.fn()])
    .mockImplementationOnce(() => [selections, vi.fn()])
    .mockImplementationOnce(() => [false, setReturnConfirmationSubmitting]);

  return {
    result: useReturnTagProcessing({ fetchBulkTanks, locale }),
    setReturnConfirmationSubmitting,
  };
}

describe("useReturnTagProcessing confirmation", () => {
  beforeEach(() => {
    useStateMock.mockReset();
    requireStaffIdentityMock.mockReset();
    requireStaffIdentityMock.mockReturnValue(ACTOR);
    confirmPendingReturnRequestsMock.mockReset();
    confirmPendingReturnRequestsMock.mockResolvedValue({ processedCount: 1 });
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits a selected canonical condition", async () => {
    const group = createReturnGroup("unused");
    const selections = createSelections("unused");
    const { result } = HookHarness(group, selections, "ja");

    await result.confirmSelectedReturnRequests();

    expect(confirmPendingReturnRequestsMock).toHaveBeenCalledWith({
      group,
      selections,
      actor: ACTOR,
    });
  });

  it.each(["ja", "en"] as const)(
    "%s submits a selected unknown condition unchanged",
    async (locale) => {
      const group = createReturnGroup("legacy_condition");
      const selections = createSelections("legacy_condition");
      const { result } = HookHarness(group, selections, locale);

      await result.confirmSelectedReturnRequests();

      expect(confirmPendingReturnRequestsMock).toHaveBeenCalledTimes(1);
      const input = confirmPendingReturnRequestsMock.mock.calls[0][0];
      expect(input.group).toBe(group);
      expect(input.selections).toBe(selections);
      expect(input.selections["return-1"]?.selected).toBe(true);
      expect(input.selections["return-1"]?.condition).toBe("legacy_condition");
    },
  );

  it.each(["ja", "en"] as const)(
    "%s refuses only when no item is selected",
    async (locale) => {
      const group = createReturnGroup("legacy_condition");
      const selections = createSelections("legacy_condition", false);
      const { result, setReturnConfirmationSubmitting } = HookHarness(
        group,
        selections,
        locale,
      );

      await result.confirmSelectedReturnRequests();

      expect(confirmPendingReturnRequestsMock).not.toHaveBeenCalled();
      expect(requireStaffIdentityMock).not.toHaveBeenCalled();
      expect(setReturnConfirmationSubmitting).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledTimes(1);
    },
  );

  it("renders a typed return-tag validation specifically in English without changing submission calls", async () => {
    const group = createReturnGroup("unused");
    const selections = createSelections("unused");
    const error = new StaffOperationError("invalid_tank_id", {
      params: { tankId: "BAD/01" },
      message: "[BAD/01] タンクIDを入力してください",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    confirmPendingReturnRequestsMock.mockRejectedValueOnce(error);
    const { result, setReturnConfirmationSubmitting } = HookHarness(
      group,
      selections,
      "en",
    );

    await result.confirmSelectedReturnRequests();

    expect(confirmPendingReturnRequestsMock).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "Tank ID BAD/01 is invalid. Review the tank number.",
    );
    expect(String(vi.mocked(alert).mock.calls[0][0])).not.toMatch(
      /[\u3040-\u30ff\u3400-\u9fff]/u,
    );
    expect(setReturnConfirmationSubmitting.mock.calls.map(([value]) => value)).toEqual([
      true,
      false,
    ]);
    consoleError.mockRestore();
  });

  it("uses the return-tag scoped fallback for an unknown English failure", async () => {
    const group = createReturnGroup("unused");
    const selections = createSelections("unused");
    const error = new Error("内部エラー");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    confirmPendingReturnRequestsMock.mockRejectedValueOnce(error);
    const { result } = HookHarness(group, selections, "en");

    await result.confirmSelectedReturnRequests();

    expect(consoleError).toHaveBeenCalledWith(
      "Return tag processing failed",
      error,
    );
    expect(alert).toHaveBeenCalledWith(
      "The return tags could not be processed. Contact an administrator if the problem persists.",
    );
    expect(String(vi.mocked(alert).mock.calls[0][0])).not.toMatch(
      /[\u3040-\u30ff\u3400-\u9fff]/u,
    );
    consoleError.mockRestore();
  });
});
