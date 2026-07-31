import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkReturnGroupReadiness } from "../bulk-return-cycle-readiness";
import type { UseBulkReturnByLocationResult } from "../hooks/useBulkReturnByLocation";
import type { BulkTankWithTag } from "../queries/bulk-return-candidates";
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
}: {
  tanks: BulkTankWithTag[];
  readiness?: BulkReturnGroupReadiness;
  expanded?: boolean;
  isReturning?: boolean;
}): UseBulkReturnByLocationResult {
  return {
    bulkLoading: false,
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
    content.includes("一括返却") || content.includes("返却/持ち越し")
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
