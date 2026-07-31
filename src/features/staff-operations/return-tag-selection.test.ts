import { describe, expect, it } from "vitest";
import type { ReturnConfirmationSelectionMap, ReturnGroup } from "./types";
import { countProcessableReturnTags, getReturnTagSelectionIssue } from "./return-tag-selection";

const GROUP: ReturnGroup = {
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

describe("return tag selection validation", () => {
  it("keeps known canonical tag values processable", () => {
    const selections: ReturnConfirmationSelectionMap = {
      "return-1": { selected: true, condition: "unused" },
    };
    expect(getReturnTagSelectionIssue(GROUP, selections)).toBeNull();
    expect(countProcessableReturnTags(GROUP, selections)).toBe(1);
  });

  it("blocks an unknown tag until the operator selects a canonical value", () => {
    const selections = {
      "return-1": { selected: true, condition: "legacy_condition" },
    } as unknown as ReturnConfirmationSelectionMap;
    expect(getReturnTagSelectionIssue(GROUP, selections)).toBe("invalid_condition");
    expect(countProcessableReturnTags(GROUP, selections)).toBe(0);
  });

  it("distinguishes no selection from an invalid selected condition", () => {
    const selections = {
      "return-1": { selected: false, condition: "legacy_condition" },
    } as unknown as ReturnConfirmationSelectionMap;
    expect(getReturnTagSelectionIssue(GROUP, selections)).toBe("none_selected");
  });
});
