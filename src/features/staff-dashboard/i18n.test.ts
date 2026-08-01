import { describe, expect, it } from "vitest";
import {
  DASHBOARD_TEXT,
  formatBulkLocationDescription,
  formatBulkVoidDescription,
  formatDashboardActiveLogs,
  formatDashboardActionLabel,
  formatDashboardCustomerCount,
  formatDashboardDateTime,
  formatDashboardLocationOption,
  formatDashboardLogLocation,
  formatDashboardLogKind,
  formatDashboardOperationCount,
  formatDashboardPartialFailure,
  formatDashboardReportCount,
  formatDashboardReportSource,
  formatDashboardReportStatus,
  formatDashboardSelectedCount,
  formatDashboardStaffName,
  formatDashboardTankId,
  formatDashboardTankStatusLabel,
} from "./i18n";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("staff dashboard i18n", () => {
  it("keeps every English dictionary value free of Japanese chrome", () => {
    for (const value of Object.values(DASHBOARD_TEXT)) {
      expect(value.ja).toBeTruthy();
      expect(value.en).toBeTruthy();
      expect(value.en).not.toMatch(JAPANESE_TEXT);
    }
  });

  it("preserves Japanese spacing and name suffixes", () => {
    expect(formatDashboardActiveLogs(2, "ja")).toBe("直近 2 件（active）");
    expect(formatDashboardSelectedCount(1, "ja")).toBe("選択 1 件");
    expect(formatDashboardStaffName("担当者A", "ja")).toBe("担当者A さん");
    expect(formatBulkLocationDescription(2, "ja")).toBe("選択中 2 件の貸出先をまとめて変更します。");
    expect(formatBulkVoidDescription(2, "ja")).toBe("選択中 2 件のログを取り消します。");
  });

  it("formats English counts and known internal labels", () => {
    expect(formatDashboardActiveLogs(1, "en")).toBe("1 active log");
    expect(formatDashboardActiveLogs(2, "en")).toBe("2 active logs");
    expect(formatDashboardSelectedCount(2, "en")).toBe("Selected 2 items");
    expect(formatDashboardCustomerCount(1, "en")).toBe("1 customer");
    expect(formatDashboardOperationCount(2, "en")).toBe("2 operations");
    expect(formatDashboardReportCount(1, "en")).toBe("1 report");
    expect(formatDashboardStaffName("Alex", "en")).toBe("Alex");
    expect(formatDashboardLogKind("order", "en")).toBe("Supply order");
    expect(formatDashboardLogKind("procurement", "en")).toBe("Tank procurement");
    expect(formatDashboardLogKind("order", "ja")).toBe("order");
  });

  it("keeps customer names raw while localizing system locations", () => {
    expect(formatDashboardLocationOption("自社", false, "en")).toBe("自社");
    expect(formatDashboardLocationOption("自社", true, "en")).toBe("In-house");
    expect(formatDashboardLogLocation({ location: "倉庫" }, "en")).toBe("Warehouse");
    expect(formatDashboardLogLocation({ location: "自社", customerId: "customer-1" }, "en")).toBe("自社");
    expect(formatDashboardLogLocation({ location: "倉庫", action: "lend" }, "en")).toBe("倉庫");
    expect(formatDashboardLogLocation({ location: "自社", action: "受注貸出" }, "en")).toBe("自社");
    expect(formatDashboardLogLocation({ location: "倉庫", action: "return", customerId: "customer-1" }, "en")).toBe("Warehouse");
    expect(formatDashboardLogLocation({ location: "未知場所", action: "return" }, "en")).toBe("Unknown location");
    expect(formatDashboardLogLocation({ location: "" }, "ja")).toBe("-");
  });

  it("hides unknown system values in English and preserves Japanese raw values", () => {
    expect(formatDashboardActionLabel("未知操作", "en")).toBe("Unknown action");
    expect(formatDashboardActionLabel("未知操作", "ja")).toBe("未知操作");
    expect(formatDashboardTankStatusLabel("未知状態", "en")).toBe("Unknown status");
    expect(formatDashboardTankStatusLabel("未知状態", "ja")).toBe("未知状態");
    expect(formatDashboardReportSource("未知source", "en")).toBe("Unknown source");
    expect(formatDashboardReportStatus("未知status", "en")).toBe("Unknown report status");
    expect(formatDashboardReportStatus("pending", "en")).toBe("Pending");
    expect(formatDashboardLogKind("未知kind", "en")).toBe("Unknown log type");
  });

  it("localizes only the reviewed persisted procurement summary marker", () => {
    expect(formatDashboardTankId("A-01 他2本", "procurement", "en")).toBe("A-01 +2 more");
    expect(formatDashboardTankId("顧客入力", "tank", "en")).toBe("顧客入力");
    expect(formatDashboardTankId("A-01 他2本", "procurement", "ja")).toBe("A-01 他2本");
  });

  it("does not expose raw partial failure details in English", () => {
    const message = formatDashboardPartialFailure("void", ["内部エラー"], "en");
    expect(message).not.toMatch(JAPANESE_TEXT);
    expect(message).not.toContain("内部エラー");
    expect(formatDashboardDateTime(new Date(2026, 6, 25, 10, 5), "ja")).toBe("7/25 10:05");
  });
});
