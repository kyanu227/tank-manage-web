import { describe, expect, it } from "vitest";
import type { ReturnSegmentKey, ReturnSegmentStat } from "./components/ReturnSegmentGestureLauncher";
import { resolveVisibleReturnSegments } from "./return-board-segments";

function stat(key: ReturnSegmentKey, customerCount: number, tankCount: number): ReturnSegmentStat {
  return {
    key,
    label: key,
    shortLabel: key,
    customerCount,
    tankCount,
    taggedCount: 0,
    color: "#000",
    background: "#fff",
  };
}

const idle = { bulkBusy: false, tagsBusy: false, activeSegment: null };

describe("resolveVisibleReturnSegments", () => {
  it("keeps only the segments that have targets, in display order", () => {
    expect(resolveVisibleReturnSegments({
      ...idle,
      segments: [
        stat("normal", 4, 12),
        stat("customer_requests", 2, 3),
        stat("long_term", 0, 0),
      ],
    })).toEqual(["normal", "customer_requests"]);
  });

  it("drops every segment when nothing is waiting to be returned", () => {
    expect(resolveVisibleReturnSegments({
      ...idle,
      segments: [
        stat("normal", 0, 0),
        stat("customer_requests", 0, 0),
        stat("long_term", 0, 0),
      ],
    })).toEqual([]);
  });

  it("counts a segment as present when only the customer count is known", () => {
    expect(resolveVisibleReturnSegments({
      ...idle,
      segments: [stat("normal", 1, 0), stat("customer_requests", 0, 0), stat("long_term", 0, 0)],
    })).toEqual(["normal"]);
  });

  it("keeps empty segments visible while their source is loading or failed", () => {
    const segments = [
      stat("normal", 0, 0),
      stat("customer_requests", 0, 0),
      stat("long_term", 0, 0),
    ];

    expect(resolveVisibleReturnSegments({ ...idle, segments, bulkBusy: true }))
      .toEqual(["normal", "long_term"]);
    expect(resolveVisibleReturnSegments({ ...idle, segments, tagsBusy: true }))
      .toEqual(["customer_requests"]);
  });

  it("keeps the gesture-selected segment even when it has no target", () => {
    expect(resolveVisibleReturnSegments({
      ...idle,
      activeSegment: "long_term",
      segments: [stat("normal", 4, 12), stat("customer_requests", 2, 3), stat("long_term", 0, 0)],
    })).toEqual(["long_term"]);
  });
});
