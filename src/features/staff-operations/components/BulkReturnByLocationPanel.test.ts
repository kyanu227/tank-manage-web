import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkReturnGroupReadiness } from "../bulk-return-cycle-readiness";
import type { UseBulkReturnByLocationResult } from "../hooks/useBulkReturnByLocation";
import type { BulkTankWithTag } from "../queries/bulk-return-candidates";
import type { BulkReturnGroupMeta } from "../types";
import BulkReturnByLocationPanel from "./BulkReturnByLocationPanel";

const localeState = vi.hoisted(() => ({ current: "ja" }));

vi.mock("@/hooks/useStaffSession", () => ({
  useStaffLocale: () => localeState.current,
}));

const GROUP_KEY = "today_lent::customer-001";

function noop(): void {}

async function noopAsync(): Promise<void> {}

function makeTank(
  id: string,
  staff: string,
  overrides: Partial<BulkTankWithTag> = {},
): BulkTankWithTag {
  return {
    id,
    status: "lent",
    customerId: "customer-001",
    customerName: "顧客A",
    latestLogId: `log-${id}`,
    location: "顧客A",
    staff,
    updatedAt: null,
    tag: "normal",
    ...overrides,
  };
}

function makeBulk({
  tanks,
  readiness,
  expanded = true,
  isReturning = false,
  bulkLoading = false,
  bulkLoadFailed = false,
  metaOverrides = {},
}: {
  tanks: BulkTankWithTag[];
  readiness?: BulkReturnGroupReadiness;
  expanded?: boolean;
  isReturning?: boolean;
  bulkLoading?: boolean;
  bulkLoadFailed?: boolean;
  metaOverrides?: Partial<BulkReturnGroupMeta>;
}): UseBulkReturnByLocationResult {
  return {
    bulkLoading,
    bulkLoadFailed,
    groupedTanks: {
      [GROUP_KEY]: tanks,
    },
    groupMeta: {
      [GROUP_KEY]: {
        key: "customer-001",
        location: "顧客A",
        customerId: "customer-001",
        pool: "today_lent",
        poolLabel: "本日貸出",
        dateLabel: "7/30 貸出分",
        sortMillis: 1,
        ...metaOverrides,
      },
    },
    groupReadiness: readiness
      ? { [GROUP_KEY]: readiness }
      : {},
    expanded: {
      [GROUP_KEY]: expanded,
    },
    returning: {
      [GROUP_KEY]: isReturning,
    },
    groupKeys: [GROUP_KEY],
    fetchBulkTanks: noopAsync,
    toggleExpand: noop,
    updateTag: noopAsync,
    handleBulkReturnForGroup: noopAsync,
  };
}

function renderPanel(bulk: UseBulkReturnByLocationResult): string {
  return renderToStaticMarkup(
    React.createElement(BulkReturnByLocationPanel, {
      bulk,
      activeSegment: "normal",
    }),
  );
}

function getBulkReturnButtonOpeningTag(html: string): string {
  const buttons = [...html.matchAll(/(<button[^>]*>)([\s\S]*?)<\/button>/g)];
  const match = buttons.find(([, , content]) => (
    content.includes("一括返却")
      || content.includes("返却/持ち越し")
      || content.includes("Bulk return")
      || content.includes("Return / Carry over")
  ));
  if (!match) throw new Error("一括返却 button が見つかりません");
  return match[1];
}

function getDescribedByIds(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]+)"/g)]
    .map((match) => match[1]);
}

function getWarningOpeningTag(html: string, warningId: string): string {
  const pattern = new RegExp(
    `<[^>]+id="${escapeRegExp(warningId)}"[^>]*>`,
  );
  const match = html.match(pattern);
  if (!match) throw new Error(`warning ${warningId} が見つかりません`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function occurrenceCount(html: string, value: string): number {
  return html.split(value).length - 1;
}

describe("BulkReturnByLocationPanel cycle readiness static render", () => {
  beforeEach(() => {
    localeState.current = "ja";
  });

  it("valid / not-returning は button と selector を従来どおり利用可能にする", () => {
    const html = renderPanel(makeBulk({
      tanks: [makeTank("VALID-01", "VALID-ROW-SENTINEL")],
      readiness: { ready: true, issues: [] },
    }));
    const button = getBulkReturnButtonOpeningTag(html);

    expect(button).not.toContain("disabled");
    expect(button).not.toContain("aria-describedby");
    expect(html).not.toContain("role=\"alert\"");
    expect(html).toContain("VALID-ROW-SENTINEL");
    expect(occurrenceCount(html, "aria-pressed=")).toBe(3);
  });

  it("invalid / not-returning は row を残し selector を処理不能表示へ置き換える", () => {
    const html = renderPanel(makeBulk({
      tanks: [
        makeTank("INVALID-01", "INVALID-ROW-SENTINEL", {
          customerId: null,
        }),
      ],
      readiness: {
        ready: false,
        issues: [{ tankId: "INVALID-01", field: "customerId" }],
      },
    }));
    const button = getBulkReturnButtonOpeningTag(html);

    expect(button).toContain("disabled");
    expect(button).toContain("aria-describedby");
    expect(html).toContain("INVALID-ROW-SENTINEL");
    expect(html).toContain("cycle情報不足");
    expect(html).toContain("処理不可");
    expect(html).toContain("顧客ID");
    expect(occurrenceCount(html, "aria-pressed=")).toBe(0);
  });

  it("mixed group は invalid row を残し valid row の selector だけを維持する", () => {
    const html = renderPanel(makeBulk({
      tanks: [
        makeTank("VALID-01", "VALID-MIXED-SENTINEL"),
        makeTank("INVALID-01", "INVALID-MIXED-SENTINEL", {
          latestLogId: "",
        }),
      ],
      readiness: {
        ready: false,
        issues: [{ tankId: "INVALID-01", field: "latestLogId" }],
      },
    }));

    expect(html).toContain("VALID-MIXED-SENTINEL");
    expect(html).toContain("INVALID-MIXED-SENTINEL");
    expect(html).toContain("INVALID-01");
    expect(html).toContain("最新操作ID");
    expect(occurrenceCount(html, "aria-pressed=")).toBe(3);
  });

  it("collapsed 状態でも warning・tank ID・tank ごとの不足 field を表示する", () => {
    const html = renderPanel(makeBulk({
      tanks: [
        makeTank("COLLAPSED-01", "COLLAPSED-ROW-SENTINEL", {
          customerId: null,
          latestLogId: null,
        }),
      ],
      readiness: {
        ready: false,
        issues: [
          { tankId: "COLLAPSED-01", field: "customerId" },
          { tankId: "COLLAPSED-01", field: "latestLogId" },
        ],
      },
      expanded: false,
    }));

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("COLLAPSED-01");
    expect(html).toContain("顧客ID");
    expect(html).toContain("最新操作ID");
    expect(html).not.toContain("COLLAPSED-ROW-SENTINEL");
  });

  it("英語 locale で warning・invalid row・不足 field を人間向け表示する", () => {
    localeState.current = "en";
    const html = renderPanel(makeBulk({
      tanks: [
        makeTank("EN-INVALID-01", "EN-ROW-SENTINEL", {
          latestLogId: undefined,
        }),
      ],
      readiness: {
        ready: false,
        issues: [{ tankId: "EN-INVALID-01", field: "latestLogId" }],
      },
    }));

    expect(html).toContain(
      "This group cannot be returned because some tanks are missing cycle information.",
    );
    expect(html).toContain("Affected:");
    expect(html).toContain("Missing:");
    expect(html).toContain("latest operation ID");
    expect(html).toContain("Cycle information missing");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("latestLogId");
  });

  it("英語 locale でquery由来の日本語metadataを表示せず件数とtagをlocalizeする", () => {
    localeState.current = "en";
    const html = renderPanel(makeBulk({
      tanks: [
        makeTank("EN-TAG-01", "Staff A", { tag: "uncharged" }),
        makeTank("EN-TAG-02", "Staff B", { tag: "unused" }),
        makeTank("EN-TAG-03", "Staff C", { tag: "keep" }),
        makeTank("EN-TAG-04", "Staff D", { tag: "uncharged" }),
      ],
      readiness: { ready: true, issues: [] },
      metaOverrides: {
        location: "Customer A",
        poolLabel: "本日貸出",
        dateLabel: "7/30 貸出分",
      },
    }));

    expect(html).toContain("1 customer / 4 tanks");
    expect(html).toContain("4 tagged tanks");
    expect(html).toContain("Rented today");
    expect(html).toContain("Today");
    expect(html).toContain("Return / Carry over");
    expect(html).toContain("Uncharged");
    expect(html).toContain("Unused");
    expect(html).toContain("Carry over");
    expect(html).toContain("+1 more");
    expect(html).toContain("flex-direction:column");
    expect(html).not.toContain("本日貸出");
    expect(html).not.toContain("7/30 貸出分");
    expect(html).not.toContain("返却/持ち越し");
    expect(html).not.toContain("一括返却");
  });

  it("英語 locale の単数件数とbulk actionを単数形で表示する", () => {
    localeState.current = "en";
    const html = renderPanel(makeBulk({
      tanks: [makeTank("EN-ONE-01", "Staff A")],
      readiness: { ready: true, issues: [] },
      metaOverrides: { location: "Customer A" },
    }));

    expect(html).toContain("1 customer / 1 tank");
    expect(html).toContain("1 tank rented");
    expect(html).toContain("Bulk return");
    expect(html).not.toContain("1 customers");
    expect(html).not.toContain("1 tanks");
  });

  it("英語 locale でinternal date fieldを露出せず長い顧客・タンク・担当者表示をwrapする", () => {
    localeState.current = "en";
    const longCustomer = "CustomerWithAnExtremelyLongUnbrokenDisplayName";
    const longTankId = "TANK-WITH-AN-EXTREMELY-LONG-UNBROKEN-ID";
    const longStaff = "StaffWithAnExtremelyLongUnbrokenDisplayName";
    const html = renderPanel(makeBulk({
      tanks: [makeTank(longTankId, longStaff)],
      readiness: { ready: true, issues: [] },
      metaOverrides: {
        location: longCustomer,
        pool: "unknown_lent",
        poolLabel: "日付不明",
        dateLabel: "貸出日不明",
        sortMillis: Number.NaN,
      },
    }));

    expect(html).toContain("Rented tanks with no recorded rental date");
    expect(html).not.toContain("updatedAt");
    expect(html).toMatch(new RegExp(`<span style="[^"]*overflow-wrap:anywhere[^"]*">${longCustomer}</span>`));
    expect(html).toMatch(new RegExp(`<span style="[^"]*overflow-wrap:anywhere[^"]*">${longTankId}</span>`));
    expect(html).toMatch(new RegExp(`<span style="[^"]*overflow-wrap:anywhere[^"]*">${longStaff}</span>`));
  });

  it("読み込みと読み込み失敗をempty stateと区別して英語表示する", () => {
    localeState.current = "en";
    const base = {
      tanks: [makeTank("EN-LOAD-01", "Staff A")],
      readiness: { ready: true, issues: [] } satisfies BulkReturnGroupReadiness,
      metaOverrides: { location: "Customer A" },
    };
    const loadingHtml = renderPanel(makeBulk({ ...base, bulkLoading: true }));
    const failedHtml = renderPanel(makeBulk({ ...base, bulkLoadFailed: true }));

    expect(loadingHtml).toContain("role=\"status\"");
    expect(loadingHtml).toContain("Loading rented tanks");
    expect(loadingHtml).not.toContain("No rented tanks");
    expect(failedHtml).toContain("role=\"alert\"");
    expect(failedHtml).toContain("Could not load rented tanks.");
    expect(failedHtml).toContain("Retry");
    expect(failedHtml).not.toContain("No rented tanks");
  });

  it("accordionとsubmitにkeyboard・aria stateを付与し狭幅gridのoverflowを防ぐ", () => {
    const html = renderPanel(makeBulk({
      tanks: [makeTank("A11Y-01", "A11Y-STAFF")],
      readiness: { ready: true, issues: [] },
    }));
    const accordionTag = html.match(/<button[^>]*aria-expanded="true"[^>]*>/)?.[0];
    const bodyId = accordionTag?.match(/aria-controls="([^"]+)"/)?.[1];
    const submitTag = getBulkReturnButtonOpeningTag(html);

    expect(accordionTag).toContain("type=\"button\"");
    expect(bodyId).toBeTruthy();
    expect(html).toContain(`id="${bodyId}"`);
    expect(submitTag).toContain("aria-busy=\"false\"");
    expect(html).toContain("minmax(min(100%, 320px), 1fr)");
    expect(html).toContain("flex-wrap:wrap");
  });

  it("readiness undefined は field を捏造せず button と selector を利用不能にする", () => {
    const html = renderPanel(makeBulk({
      tanks: [makeTank("UNKNOWN-01", "UNKNOWN-ROW-SENTINEL")],
    }));
    const button = getBulkReturnButtonOpeningTag(html);

    expect(button).toContain("disabled");
    expect(button).toContain("aria-describedby");
    expect(html).toContain("cycle情報を確認できません。再読込してください。");
    expect(html).toContain("処理不可");
    expect(html).not.toContain("対象:");
    expect(html).not.toContain("顧客ID");
    expect(html).not.toContain("最新操作ID");
    expect(occurrenceCount(html, "aria-pressed=")).toBe(0);
  });

  it("valid / returning は disabled でも存在しない cycle warning を参照しない", () => {
    const html = renderPanel(makeBulk({
      tanks: [makeTank("RETURNING-01", "RETURNING-ROW-SENTINEL")],
      readiness: { ready: true, issues: [] },
      isReturning: true,
    }));
    const button = getBulkReturnButtonOpeningTag(html);

    expect(button).toContain("disabled");
    expect(button).not.toContain("aria-describedby");
    expect(html).not.toContain("role=\"alert\"");
    expect(occurrenceCount(html, "aria-pressed=")).toBe(3);
  });

  it("同一 tree の2 Panel で warning ID と aria-describedby の対応を一意にする", () => {
    const bulk = makeBulk({
      tanks: [
        makeTank("DUPLICATE-CHECK-01", "DUPLICATE-ROW-SENTINEL", {
          customerId: null,
        }),
      ],
      readiness: {
        ready: false,
        issues: [{ tankId: "DUPLICATE-CHECK-01", field: "customerId" }],
      },
      expanded: false,
    });
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(BulkReturnByLocationPanel, {
          bulk,
          activeSegment: "normal",
        }),
        React.createElement(BulkReturnByLocationPanel, {
          bulk,
          activeSegment: "normal",
        }),
      ),
    );
    const describedByIds = getDescribedByIds(html);

    expect(describedByIds).toHaveLength(2);
    expect(new Set(describedByIds).size).toBe(2);
    describedByIds.forEach((warningId) => {
      expect(occurrenceCount(html, `id="${warningId}"`)).toBe(1);
    });
  });

  it("warning 要素自身に mobile wrapping style を設定する", () => {
    const html = renderPanel(makeBulk({
      tanks: [
        makeTank("WRAP-01", "WRAP-ROW-SENTINEL", {
          customerId: null,
        }),
      ],
      readiness: {
        ready: false,
        issues: [{ tankId: "WRAP-01", field: "customerId" }],
      },
    }));
    const [warningId] = getDescribedByIds(html);
    const warningTag = getWarningOpeningTag(html, warningId);

    expect(warningTag).toContain("min-width:0");
    expect(warningTag).toContain("white-space:normal");
    expect(warningTag).toContain("overflow-wrap:anywhere");

    // static render は click behavior・実 mobile layout・screen reader の挙動を証明しない。
  });
});
