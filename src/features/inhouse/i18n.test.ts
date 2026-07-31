import { describe, expect, it } from "vitest";
import {
  INHOUSE_TEXT,
  formatInHouseAlreadyActive,
  formatInHouseBulkConfirm,
  formatInHouseReportSuccess,
  formatInHouseUnregistered,
  formatReturnTagAriaLabel,
} from "./i18n";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("in-house i18n", () => {
  it("keeps every English dictionary value free of Japanese chrome", () => {
    for (const value of Object.values(INHOUSE_TEXT)) {
      expect(value.ja).toBeTruthy();
      expect(value.en).toBeTruthy();
      expect(value.en).not.toMatch(JAPANESE_TEXT);
    }
  });

  it("localizes stable result branches without changing tank IDs", () => {
    expect(formatInHouseUnregistered("A-01", "en")).toBe("A-01 is not registered.");
    expect(formatInHouseAlreadyActive("A-01", "en")).toBe("A-01 is already in use in-house.");
    expect(formatInHouseReportSuccess("A-01", "en")).toBe("Recorded past in-house use for A-01.");
    expect(formatReturnTagAriaLabel("A-01", "en")).toBe("Return tag for A-01");
  });

  it("uses singular and plural tank counts in the English confirmation", () => {
    expect(formatInHouseBulkConfirm(1, "en")).toContain("all 1 tank currently");
    expect(formatInHouseBulkConfirm(2, "en")).toContain("all 2 tanks currently");
    expect(formatInHouseBulkConfirm(2, "ja")).toBe(
      "自社利用中のタンク全 2 本を一括返却しますか？\n(タグ付けに応じて処理されます)",
    );
  });
});
