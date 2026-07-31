import { describe, expect, it } from "vitest";
import {
  MYPAGE_TEXT,
  formatMyPageLocation,
  formatMyPageTime,
  formatProfileDescription,
  formatRecentWorkTitle,
  getLocaleOptionLabel,
  getStaffRoleDisplayLabel,
} from "./mypage-i18n";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("staff my-page i18n", () => {
  it("keeps every English dictionary value free of Japanese chrome", () => {
    for (const value of Object.values(MYPAGE_TEXT)) {
      expect(value.en).not.toMatch(JAPANESE_TEXT);
    }
  });

  it("uses the UI locale for language option labels", () => {
    expect(getLocaleOptionLabel("ja", "ja")).toBe("日本語");
    expect(getLocaleOptionLabel("ja", "en")).toBe("Japanese");
    expect(getLocaleOptionLabel("en", "ja")).toBe("English");
  });

  it("maps canonical roles for English display and hides unknown system roles", () => {
    expect(getStaffRoleDisplayLabel("管理者", "en")).toBe("Administrator");
    expect(getStaffRoleDisplayLabel("準管理者", "en")).toBe("Assistant administrator");
    expect(getStaffRoleDisplayLabel("worker", "en")).toBe("Staff");
    expect(getStaffRoleDisplayLabel("未知権限", "en")).toBe("Unknown role");
    expect(getStaffRoleDisplayLabel("admin", "ja")).toBe("admin");
    expect(getStaffRoleDisplayLabel("worker", "ja")).toBe("worker");
    expect(formatProfileDescription("admin", "Gold", "en")).toBe("Administrator / Rank: Gold");
  });

  it("distinguishes customer names from system locations without changing Japanese output", () => {
    expect(formatMyPageLocation({ location: "自社", customerName: "自社" }, "en")).toBe("自社");
    expect(formatMyPageLocation({ location: "倉庫", action: "貸出" }, "en")).toBe("倉庫");
    expect(formatMyPageLocation({ location: "倉庫", action: "返却", customerName: "自社" }, "en")).toBe("Warehouse");
    expect(formatMyPageLocation({ location: "自社" }, "en")).toBe("In-house");
    expect(formatMyPageLocation({ location: "未知場所", action: "返却" }, "en")).toBe("Unknown location");
    expect(formatMyPageLocation({ location: "" }, "ja")).toBe("");
  });

  it("preserves Japanese time and localizes the recent-work count", () => {
    const date = new Date(2026, 6, 25, 10, 5);
    expect(formatMyPageTime(date, "ja")).toBe("7/25 10:05");
    expect(formatRecentWorkTitle(100, "en")).toBe("Recent work (latest 100 entries)");
  });
});
