import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReturnSegmentGestureLauncher, {
  type ReturnSegmentStat,
} from "./ReturnSegmentGestureLauncher";

const ENGLISH_SEGMENTS: ReturnSegmentStat[] = [
  {
    key: "normal",
    label: "Normal returns",
    shortLabel: "Normal",
    customerCount: 1,
    tankCount: 1,
    taggedCount: 0,
    color: "#0891b2",
    background: "#ecfeff",
  },
  {
    key: "customer_requests",
    label: "Pending return tags",
    shortLabel: "Tags",
    customerCount: 2,
    tankCount: 3,
    taggedCount: 3,
    color: "#10b981",
    background: "#ecfdf5",
  },
  {
    key: "long_term",
    label: "Long-term rentals",
    shortLabel: "Long-term",
    customerCount: 0,
    tankCount: 0,
    taggedCount: 0,
    color: "#be123c",
    background: "#fff1f2",
  },
];

describe("ReturnSegmentGestureLauncher static presentation", () => {
  it("uses localized segment data and plural-safe English titles", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReturnSegmentGestureLauncher, {
        activeSegment: "normal",
        segments: ENGLISH_SEGMENTS,
        locale: "en",
        onSelectSegment: vi.fn(),
        onSelectManualReturn: vi.fn(),
      }),
    );

    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("Normal returns: 1 customer / 1 tank");
    expect(html).toContain("Pending return tags: 2 customers / 3 tanks");
    expect(html).not.toContain("1 customers");
    expect(html).not.toContain("1 tanks");
    expect(html).not.toMatch(/[぀-ヿ㐀-鿿]/u);
  });
});
