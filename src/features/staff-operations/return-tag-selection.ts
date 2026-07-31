import { isReturnTag } from "@/lib/return-tag-rules";
import type { ReturnConfirmationSelectionMap, ReturnGroup } from "./types";

export type ReturnTagSelectionIssue = "none_selected" | "invalid_condition" | null;

export function getReturnTagSelectionIssue(
  group: ReturnGroup,
  selections: ReturnConfirmationSelectionMap,
): ReturnTagSelectionIssue {
  const selectedItems = group.items.filter((item) => selections[item.id]?.selected);
  if (selectedItems.length === 0) return "none_selected";
  return selectedItems.some((item) => !isReturnTag(selections[item.id]?.condition))
    ? "invalid_condition"
    : null;
}

export function countProcessableReturnTags(
  group: ReturnGroup,
  selections: ReturnConfirmationSelectionMap,
): number {
  return group.items.filter((item) => (
    selections[item.id]?.selected
    && isReturnTag(selections[item.id]?.condition)
  )).length;
}
