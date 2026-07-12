import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/config", () => ({ db: {} }));

import { classifyMonthlyStatRevision } from "@/lib/firebase/monthly-stats-service";

describe("monthly stats aggregation revision compatibility", () => {
  it("classifies a legacy archive as unknown with an explicit warning", () => {
    expect(classifyMonthlyStatRevision(undefined, 4)).toEqual({
      officialAggregationRevision: null,
      revisionStatus: "unknown",
      revisionWarning: "旧形式の月次アーカイブのため、正式集計revisionとの一致を確認できません。",
      isStale: false,
    });
  });

  it("marks a known older archive as stale", () => {
    expect(classifyMonthlyStatRevision(3, 4)).toEqual({
      officialAggregationRevision: 3,
      revisionStatus: "known",
      revisionWarning: undefined,
      isStale: true,
    });
  });

  it("keeps a known current archive visible", () => {
    expect(classifyMonthlyStatRevision(4, 4)).toEqual({
      officialAggregationRevision: 4,
      revisionStatus: "known",
      revisionWarning: undefined,
      isStale: false,
    });
  });

  it.each([null, -1, 1.5, "4"])(
    "treats invalid saved revision %j as unknown",
    (value) => {
      expect(classifyMonthlyStatRevision(value, 4).revisionStatus).toBe("unknown");
    },
  );
});
