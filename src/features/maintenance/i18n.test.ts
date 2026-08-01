import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_TEXT,
  formatDamageConfirm,
  formatDamageSuccess,
  formatInspectionConfirm,
  formatInspectionDate,
  formatInspectionDescription,
  formatInspectionRemaining,
  formatInspectionSubmit,
  formatRepairConfirm,
  formatRepairSubmit,
} from "./i18n";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("maintenance i18n", () => {
  it("keeps every English dictionary value free of Japanese chrome", () => {
    for (const value of Object.values(MAINTENANCE_TEXT)) {
      expect(value.ja).toBeTruthy();
      expect(value.en).toBeTruthy();
      expect(value.en).not.toMatch(JAPANESE_TEXT);
    }
  });

  it("preserves the Japanese confirmations and success copy", () => {
    expect(formatDamageConfirm(2, "ja")).toBe("2本の破損報告を送信しますか？");
    expect(formatDamageSuccess(2, "ja")).toBe("2本の破損報告を完了しました");
    expect(formatRepairConfirm(2, "ja")).toBe("修理完了：2本を処理しますか？");
    expect(formatInspectionConfirm(2, 5, "ja")).toBe(
      "耐圧検査完了：2本を処理しますか？\n次回期限は 5年後 に更新されます。",
    );
  });

  it("formats English counts with singular and plural grammar", () => {
    expect(formatRepairSubmit(1, "en")).toBe("Complete repair (1 tank)");
    expect(formatRepairSubmit(2, "en")).toBe("Complete repair (2 tanks)");
    expect(formatInspectionSubmit(1, "en")).toBe("Complete inspection (1 tank)");
    expect(formatInspectionConfirm(1, 1, "en")).toContain("1 year from now");
    expect(formatInspectionConfirm(2, 5, "en")).toContain("5 years from now");
    expect(formatInspectionDescription(1, "en")).toContain("1 month");
    expect(formatInspectionDescription(2, "en")).toContain("2 months");
  });

  it("localizes inspection timing and dates", () => {
    expect(formatInspectionRemaining(-1, "en")).toBe("Expired");
    expect(formatInspectionRemaining(12, "en")).toBe("Due this month");
    expect(formatInspectionRemaining(30, "en")).toBe("Due in 1 month");
    expect(formatInspectionRemaining(61, "en")).toBe("Due in 2 months");
    expect(formatInspectionDate(new Date("2026-07-25T12:00:00+09:00"), "en")).toContain("Jul 25, 2026");
    expect(formatInspectionDate(new Date(2026, 6, 25, 12), "ja")).toBe("期限: 2026/07/25");
  });
});
