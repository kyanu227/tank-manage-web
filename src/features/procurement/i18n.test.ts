import { describe, expect, it } from "vitest";
import {
  PROCUREMENT_TEXT,
  formatPlaceOrder,
  formatProcurementItemCount,
  formatProcurementJpy,
  formatSupplyOrderConfirm,
  formatSupplyOrderSuccess,
  formatTankEntryConfirm,
  formatTankEntryDuplicate,
  formatTankEntrySubmit,
  formatTankEntrySuccess,
  getTankEntryCopy,
  getTankTypeDisplayLabel,
} from "./i18n";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("procurement i18n", () => {
  it("keeps every English dictionary value free of Japanese chrome", () => {
    for (const value of Object.values(PROCUREMENT_TEXT)) {
      expect(value.ja).toBeTruthy();
      expect(value.en).toBeTruthy();
      expect(value.en).not.toMatch(JAPANESE_TEXT);
    }
  });

  it("preserves Japanese supply-order wording and yen formatting", () => {
    expect(formatSupplyOrderConfirm(2, "ja")).toBe("2品目を発注しますか？");
    expect(formatSupplyOrderSuccess(2, 12000, "ja")).toBe("2品目の発注を完了（合計 ¥12,000）");
    expect(formatPlaceOrder(12000, "ja")).toBe("発注を確定（¥12,000）");
    expect(formatProcurementJpy(12000, "ja")).toBe("¥12,000");
  });

  it("formats English item and tank counts with singular and plural grammar", () => {
    expect(formatProcurementItemCount(1, "en")).toBe("1 item");
    expect(formatProcurementItemCount(2, "en")).toBe("2 items");
    expect(formatSupplyOrderConfirm(1, "en")).toContain("1 item");
    expect(formatTankEntrySubmit("register", 1, "en")).toBe("Register 1 tank");
    expect(formatTankEntrySubmit("purchase", 2, "en")).toBe("Purchase and register 2 tanks");
  });

  it("localizes tank-entry confirmations and success messages", () => {
    expect(formatTankEntryConfirm("register", 2, 0, "ja")).toBe("2本を登録しますか？");
    expect(formatTankEntryConfirm("purchase", 2, 12000, "ja")).toBe(
      "2本を購入登録しますか？\n合計 ¥12,000 を計上します。",
    );
    expect(formatTankEntrySuccess("purchase", 1, 6000, "en")).toBe(
      "Purchased and registered 1 tank (¥6,000).",
    );
    expect(formatTankEntryDuplicate("A-01", "en")).toBe("A-01 has already been added.");
  });

  it("maps only canonical default labels while preserving raw values", () => {
    expect(getTankTypeDisplayLabel("スチール 10L", "en")).toBe("Steel 10L");
    expect(getTankTypeDisplayLabel("アルミ", "en")).toBe("Aluminum");
    expect(getTankTypeDisplayLabel("顧客マスタ種別", "en")).toBe("顧客マスタ種別");
    expect(getTankEntryCopy("purchase", "en")).toEqual({
      title: "Tank purchase",
      description: "Register new tanks and record their purchase cost.",
      submit: "Purchase and register",
    });
  });
});
