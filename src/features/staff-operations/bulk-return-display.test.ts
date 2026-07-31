import { describe, expect, it } from "vitest";
import type { BulkReturnGroupMeta } from "./types";
import {
  formatBulkReturnCustomerTankCount,
  formatBulkReturnHiddenCount,
  formatBulkReturnTaggedTankCount,
  formatBulkReturnTankCountWithStatus,
  getBulkReturnDateLabel,
  getBulkReturnDisplayLocation,
  getBulkReturnGroupDisplayLabel,
  getBulkReturnPoolLabel,
} from "./bulk-return-display";

const SORT_MILLIS = Date.UTC(2026, 6, 29, 15);

function makeMeta(
  overrides: Partial<BulkReturnGroupMeta> = {},
): BulkReturnGroupMeta {
  return {
    key: "today_lent::customer:customer-001",
    location: "Customer A",
    customerId: "customer-001",
    pool: "today_lent",
    poolLabel: "本日貸出",
    dateLabel: "7/30 貸出分",
    sortMillis: SORT_MILLIS,
    ...overrides,
  };
}

describe("bulk return display mapping", () => {
  it("keeps Japanese count output and pluralizes English units", () => {
    expect(formatBulkReturnCustomerTankCount(1, 1, "ja")).toBe("1顧客 / 1本");
    expect(formatBulkReturnCustomerTankCount(1, 1, "en")).toBe("1 customer / 1 tank");
    expect(formatBulkReturnCustomerTankCount(2, 3, "en")).toBe("2 customers / 3 tanks");
    expect(formatBulkReturnTaggedTankCount(1, "ja")).toBe("タグ1本");
    expect(formatBulkReturnTaggedTankCount(1, "en")).toBe("1 tagged tank");
    expect(formatBulkReturnTaggedTankCount(2, "en")).toBe("2 tagged tanks");
    expect(formatBulkReturnTankCountWithStatus(1, "rented", "en")).toBe("1 tank rented");
    expect(formatBulkReturnHiddenCount(2, "ja")).toBe("+2件");
    expect(formatBulkReturnHiddenCount(2, "en")).toBe("+2 more");
  });

  it("derives English pool and date text without mutating query metadata", () => {
    const today = makeMeta();
    const before = { ...today };
    const past = makeMeta({
      pool: "past_lent",
      poolLabel: "前日以前",
      dateLabel: "7/30 以前",
    });
    const longTerm = makeMeta({
      pool: "long_term",
      poolLabel: "長期貸出",
      dateLabel: "7/30 から未返却",
    });
    const unknown = makeMeta({
      pool: "unknown_lent",
      poolLabel: "日付不明",
      dateLabel: "貸出日不明",
      sortMillis: Number.NaN,
    });

    expect(getBulkReturnPoolLabel(today, "en")).toBe("Rented today");
    expect(getBulkReturnDateLabel(today, "en")).toBe("Today's rentals");
    expect(getBulkReturnPoolLabel(past, "en")).toBe("Earlier");
    expect(getBulkReturnDateLabel(past, "en")).toBe("On or before Jul 30");
    expect(getBulkReturnPoolLabel(longTerm, "en")).toBe("Long-term");
    expect(getBulkReturnDateLabel(longTerm, "en")).toBe("Unreturned since Jul 30");
    expect(getBulkReturnPoolLabel(unknown, "en")).toBe("Unknown date");
    expect(getBulkReturnDateLabel(unknown, "en")).toBe("Rental date unknown");
    expect(today).toEqual(before);
  });

  it("preserves user-provided Japanese names and only maps generated unknown identity", () => {
    const namedCustomer = makeMeta({
      key: "today_lent::customer:warehouse-name",
      location: "倉庫",
    });
    const generatedUnknown = makeMeta({
      key: "today_lent::legacy-location:__unknown__",
      location: "不明",
      customerId: undefined,
    });
    const generatedCustomerUnknown = makeMeta({
      key: "today_lent::customer:missing-name",
      customerId: "missing-name",
      location: "不明な顧客",
    });
    const literallyNamedCustomer = makeMeta({
      key: "today_lent::customer:literal-name",
      customerId: "literal-name",
      location: "不明な顧客",
    });

    expect(getBulkReturnDisplayLocation("倉庫", namedCustomer, "en")).toBe("倉庫");
    expect(getBulkReturnDisplayLocation("不明", generatedUnknown, "en")).toBe("Unknown customer");
    expect(getBulkReturnDisplayLocation(
      "不明な顧客",
      generatedCustomerUnknown,
      "en",
      [{ customerName: null, location: "" }],
    )).toBe("Unknown customer");
    expect(getBulkReturnDisplayLocation(
      "不明な顧客",
      literallyNamedCustomer,
      "en",
      [{ customerName: "不明な顧客", location: "" }],
    )).toBe("不明な顧客");
    expect(getBulkReturnGroupDisplayLabel("倉庫", namedCustomer, "en")).toBe("倉庫 (Rented today)");
    expect(getBulkReturnGroupDisplayLabel("Customer A", makeMeta(), "ja")).toBe("Customer A（本日貸出）");
  });
});
