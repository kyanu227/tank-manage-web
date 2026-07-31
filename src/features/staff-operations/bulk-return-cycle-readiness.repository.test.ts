import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseBulkReturnByLocationResult } from "./hooks/useBulkReturnByLocation";
import {
  fetchBulkReturnCandidates,
  type BulkReturnCandidateGroups,
  type BulkTankWithTag,
} from "./queries/bulk-return-candidates";
import { getBulkReturnGroupReadiness } from "./bulk-return-cycle-readiness";
import BulkReturnByLocationPanel from "./components/BulkReturnByLocationPanel";

const mocks = vi.hoisted(() => ({
  db: { kind: "mock-db" },
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: mocks.collection,
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: mocks.getDocs,
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: mocks.query,
  serverTimestamp: vi.fn(),
  Timestamp: class MockTimestamp {
    static fromDate(value: Date): Date {
      return value;
    }
  },
  updateDoc: vi.fn(),
  where: mocks.where,
}));

vi.mock("@/lib/firebase/config", () => ({
  db: mocks.db,
}));

vi.mock("@/hooks/useStaffSession", () => ({
  useStaffLocale: () => "ja",
}));

const NOW_MILLIS = 1785553200000;

type RawTankMarkers = Readonly<{
  customerId: unknown;
  latestLogId: unknown;
}>;

function setupRepositoryDocument(markers: RawTankMarkers): void {
  const snapshot = {
    id: "RAW-CYCLE-01",
    data: () => ({
      status: "lent",
      customerId: markers.customerId,
      customerName: "顧客A",
      latestLogId: markers.latestLogId,
      location: "顧客A",
      staff: "担当者A",
      updatedAt: NOW_MILLIS,
    }),
  };
  mocks.getDocs.mockResolvedValue({
    forEach: (callback: (document: typeof snapshot) => void) => callback(snapshot),
  });
}

function getOnlyGroup(result: BulkReturnCandidateGroups): Readonly<{
  groupKey: string;
  tanks: BulkTankWithTag[];
}> {
  const entries = Object.entries(result.groupedTanks);
  expect(entries).toHaveLength(1);
  const [groupKey, tanks] = entries[0];
  return { groupKey, tanks };
}

function renderGroup(
  result: BulkReturnCandidateGroups,
  groupKey: string,
  tanks: BulkTankWithTag[],
): string {
  const readiness = getBulkReturnGroupReadiness(tanks);
  const bulk = {
    bulkLoading: false,
    groupedTanks: result.groupedTanks,
    groupMeta: result.groupMeta,
    groupReadiness: { [groupKey]: readiness },
    expanded: { [groupKey]: true },
    returning: { [groupKey]: false },
    groupKeys: [groupKey],
    fetchBulkTanks: async () => {},
    toggleExpand: () => {},
    updateTag: async () => {},
    handleBulkReturnForGroup: async () => {},
  } satisfies UseBulkReturnByLocationResult;

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

describe("bulk return raw cycle marker repository path", () => {
  beforeEach(() => {
    mocks.collection.mockReset().mockReturnValue({ kind: "collection" });
    mocks.query.mockReset().mockReturnValue({ kind: "query" });
    mocks.where.mockReset().mockReturnValue({ kind: "where" });
    mocks.getDocs.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(NOW_MILLIS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: "customerId number",
      raw: { customerId: 123, latestLogId: "log-01" },
      normalized: { customerId: "123", latestLogId: "log-01" },
      issueField: "customerId" as const,
    },
    {
      name: "latestLogId number",
      raw: { customerId: "customer-01", latestLogId: 123 },
      normalized: { customerId: "customer-01", latestLogId: "123" },
      issueField: "latestLogId" as const,
    },
    {
      name: "customerId object",
      raw: { customerId: { id: "customer-01" }, latestLogId: "log-01" },
      normalized: { customerId: "[object Object]", latestLogId: "log-01" },
      issueField: "customerId" as const,
    },
    {
      name: "customerId boolean",
      raw: { customerId: true, latestLogId: "log-01" },
      normalized: { customerId: "true", latestLogId: "log-01" },
      issueField: "customerId" as const,
    },
    {
      name: "customerId null",
      raw: { customerId: null, latestLogId: "log-01" },
      normalized: { customerId: null, latestLogId: "log-01" },
      issueField: "customerId" as const,
    },
  ])("$name は repository 正規化後も group を disabled にする", async ({
    raw,
    normalized,
    issueField,
  }) => {
    setupRepositoryDocument(raw);

    const result = await fetchBulkReturnCandidates();
    const { groupKey, tanks } = getOnlyGroup(result);
    const [tank] = tanks;
    const readiness = getBulkReturnGroupReadiness(tanks);
    const html = renderGroup(result, groupKey, tanks);

    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(tank).toMatchObject({
      customerId: normalized.customerId,
      latestLogId: normalized.latestLogId,
      rawCycleMarkers: raw,
    });
    expect(readiness).toEqual({
      ready: false,
      issues: [{ tankId: "RAW-CYCLE-01", field: issueField }],
    });
    expect(getBulkReturnButtonOpeningTag(html)).toContain("disabled");
  });

  it("両 marker が正常な非空 string なら repository 経由でも group を enabled に保つ", async () => {
    const raw = {
      customerId: "customer-01",
      latestLogId: "log-01",
    } satisfies RawTankMarkers;
    setupRepositoryDocument(raw);

    const result = await fetchBulkReturnCandidates();
    const { groupKey, tanks } = getOnlyGroup(result);
    const [tank] = tanks;
    const readiness = getBulkReturnGroupReadiness(tanks);
    const html = renderGroup(result, groupKey, tanks);

    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(tank).toMatchObject({
      customerId: raw.customerId,
      latestLogId: raw.latestLogId,
      rawCycleMarkers: raw,
    });
    expect(readiness).toEqual({ ready: true, issues: [] });
    expect(getBulkReturnButtonOpeningTag(html)).not.toContain("disabled");
  });
});
