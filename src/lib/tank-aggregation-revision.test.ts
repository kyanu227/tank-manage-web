import { describe, expect, it } from "vitest";
import {
  isOfficialAggregationSnapshotStale,
  nextTankAggregationRevisions,
  normalizeTankAggregationRevisions,
} from "@/lib/tank-aggregation-revision";

describe("tank aggregation revision responsibilities", () => {
  const current = {
    tankDataRevision: 7,
    officialAggregationRevision: 5,
  };

  it("旧revision fieldを新schemaのfallbackとして使用しない", () => {
    expect(normalizeTankAggregationRevisions({ revision: 99 })).toEqual({
      tankDataRevision: 0,
      officialAggregationRevision: 0,
    });
  });

  it("increments only the data revision when a recovery becomes pending", () => {
    const next = nextTankAggregationRevisions(current, {
      dataChanged: true,
      officialChanged: false,
    });
    expect(next).toEqual({
      tankDataRevision: 8,
      officialAggregationRevision: 5,
    });
    expect(isOfficialAggregationSnapshotStale(5, next.officialAggregationRevision)).toBe(false);
  });

  it("increments both revisions when a pending recovery is approved", () => {
    expect(nextTankAggregationRevisions(current, {
      dataChanged: true,
      officialChanged: true,
    })).toEqual({
      tankDataRevision: 8,
      officialAggregationRevision: 6,
    });
  });

  it("does not increment the official revision when a recovery is excluded", () => {
    expect(nextTankAggregationRevisions(current, {
      dataChanged: true,
      officialChanged: false,
    }).officialAggregationRevision).toBe(5);
  });

  it("increments the official revision when an approved log is voided", () => {
    expect(nextTankAggregationRevisions(current, {
      dataChanged: true,
      officialChanged: true,
    }).officialAggregationRevision).toBe(6);
  });
});
