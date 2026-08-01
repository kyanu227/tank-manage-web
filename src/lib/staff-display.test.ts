import { describe, expect, it } from "vitest";
import {
  formatStaffDate,
  formatStaffDateTime,
  formatStaffItemCount,
  formatStaffJpy,
  formatStaffShortDateTime,
  formatStaffTankCount,
  getLocalizedText,
  getStaffGenericErrorMessage,
  getStaffLocationLabel,
  getStaffTankUnit,
} from "./staff-display";

describe("staff display mapping", () => {
  it("selects explicit locale text and defaults to Japanese", () => {
    const text = { ja: "保存", en: "Save" } as const;
    expect(getLocalizedText(text)).toBe("保存");
    expect(getLocalizedText(text, "en")).toBe("Save");
  });

  it.each([
    ["倉庫", "倉庫", "Warehouse"],
    ["自社", "自社", "In-house"],
    ["不明", "不明", "Unknown"],
    ["株式会社 海", "株式会社 海", "株式会社 海"],
  ])("maps only known system locations: %s", (value, ja, en) => {
    expect(getStaffLocationLabel(value, "ja")).toBe(ja);
    expect(getStaffLocationLabel(value, "en")).toBe(en);
    expect(value).toBe(value);
  });

  it("uses a localized empty location without changing unknown values", () => {
    expect(getStaffLocationLabel(undefined, "ja")).toBe("未設定");
    expect(getStaffLocationLabel(undefined, "en")).toBe("Not set");
    expect(getStaffLocationLabel("Customer A", "en")).toBe("Customer A");
    expect(getStaffLocationLabel("  Customer A  ", "en")).toBe("  Customer A  ");
  });

  it.each([
    [0, "0本", "0 tanks"],
    [1, "1本", "1 tank"],
    [2, "2本", "2 tanks"],
  ])("formats tank counts: %i", (count, ja, en) => {
    expect(formatStaffTankCount(count, "ja")).toBe(ja);
    expect(formatStaffTankCount(count, "en")).toBe(en);
    expect(getStaffTankUnit(count, "ja")).toBe("本");
    expect(getStaffTankUnit(count, "en")).toBe(count === 1 ? "tank" : "tanks");
  });

  it.each([
    [0, "0件", "0 items"],
    [1, "1件", "1 item"],
    [2, "2件", "2 items"],
  ])("formats item counts: %i", (count, ja, en) => {
    expect(formatStaffItemCount(count, "ja")).toBe(ja);
    expect(formatStaffItemCount(count, "en")).toBe(en);
  });

  it("keeps the business timezone while localizing the date", () => {
    const instant = Date.UTC(2026, 0, 1, 16, 0);
    expect(formatStaffDate(instant, "ja")).toMatch(/^2026\/1\/2$/u);
    expect(formatStaffDate(instant, "en")).toMatch(/^Jan 2, 2026$/u);
    expect(formatStaffDateTime(instant, "ja")).toContain("2026/1/2");
    expect(formatStaffDateTime(instant, "ja")).toContain("1:00");
    expect(formatStaffDateTime(instant, "en")).toContain("Jan 2, 2026");
    expect(formatStaffDateTime(instant, "en")).toContain("01:00");
    expect(formatStaffShortDateTime(instant, "ja")).toContain("1月2日");
    expect(formatStaffShortDateTime(instant, "en")).toContain("Jan 2");
  });

  it("localizes JPY display without changing the amount", () => {
    expect(formatStaffJpy(1234, "ja")).toContain("1,234");
    expect(formatStaffJpy(1234, "en")).toContain("1,234");
  });

  it("uses a non-sensitive generic error in both locales", () => {
    expect(getStaffGenericErrorMessage("ja")).toContain("失敗");
    expect(getStaffGenericErrorMessage("en")).toBe(
      "The operation failed. Please try again later.",
    );
  });
});
