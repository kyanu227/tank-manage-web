import { describe, expect, it } from "vitest";
import {
  DASHBOARD_TEXT,
  LOG_CORRECTION_REASON_TEXT_KEYS,
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
  getLogCorrectionBlockReasonText,
} from "./i18n";
import { StaffOperationError } from "@/lib/staff-operation-error";
import { LOG_CORRECTION_BLOCK_REASONS } from "@/features/staff-dashboard/policy/log-correction-policy";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

describe("staff dashboard i18n", () => {
  it("訂正不可理由codeを既存のja/en文言へ完全に対応付ける", () => {
    expect(Object.keys(LOG_CORRECTION_REASON_TEXT_KEYS).sort()).toStrictEqual(
      [...LOG_CORRECTION_BLOCK_REASONS].sort(),
    );
    expect(LOG_CORRECTION_REASON_TEXT_KEYS).toStrictEqual({
      not_tank_log: "notTankLog",
      inactive_log: "inactiveLog",
      missing_created_at: "missingCreatedAt",
      edit_expired: "editExpired",
      transition_plan_missing: "transitionPlanMissing",
      recovery_correction_blocked: "recoveryCorrectionBlocked",
      review_correction_blocked: "reviewCorrectionBlocked",
    });

    const expected = {
      not_tank_log: {
        ja: "タンク操作ログではありません",
        en: "This is not a tank-operation log.",
      },
      inactive_log: {
        ja: "有効なログではありません",
        en: "This log is not active.",
      },
      missing_created_at: {
        ja: "作成日時が取得できず期限判定できません",
        en: "The edit deadline cannot be checked because the creation time is unavailable.",
      },
      edit_expired: {
        ja: "一般スタッフの編集可能期限を超過しています",
        en: "The editing window for staff has expired.",
      },
      transition_plan_missing: {
        ja: "transitionPlanを確認できないログは訂正できません",
        en: "This log cannot be corrected because its transition plan is unavailable.",
      },
      recovery_correction_blocked: {
        ja: "自動補完ログは取消後に正しい操作を再実行してください",
        en: "Void this recovery log, then run the correct operation again.",
      },
      review_correction_blocked: {
        ja: "集計レビュー対象のログは直接訂正できません",
        en: "Logs under review cannot be corrected directly.",
      },
    } as const;

    LOG_CORRECTION_BLOCK_REASONS.forEach((reason) => {
      expect(getLogCorrectionBlockReasonText(reason, "ja")).toBe(
        expected[reason].ja,
      );
      expect(getLogCorrectionBlockReasonText(reason, "en")).toBe(
        expected[reason].en,
      );
    });
    expect(getLogCorrectionBlockReasonText(null, "ja")).toBeNull();
  });

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
    const message = formatDashboardPartialFailure("void", [{
      tankId: "A-01",
      error: new Error("内部エラー: projects/secret/databases/internal"),
    }], "en");
    expect(message).not.toMatch(JAPANESE_TEXT);
    expect(message).not.toContain("内部エラー");
    expect(message).not.toContain("projects/");
    expect(message).toContain("Contact an administrator");
    expect(formatDashboardDateTime(new Date(2026, 6, 25, 10, 5), "ja")).toBe("7/25 10:05");
  });

  it("keeps a typed partial failure specific in English", () => {
    const message = formatDashboardPartialFailure("location", [{
      tankId: "A-01",
      error: new StaffOperationError("reason_too_short", {
        params: { minLength: 5 },
      }),
    }], "en");

    expect(message).toContain("A-01: Enter a reason of at least 5 characters.");
    expect(message).not.toMatch(JAPANESE_TEXT);
  });
});
