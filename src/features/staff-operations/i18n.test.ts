import { describe, expect, it } from "vitest";
import { STAFF_OPERATION_TEXT, getStaffOperationText } from "./i18n";

const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/gu;

describe("staff operation copy", () => {
  it("keeps complete ja/en entries with matching placeholders", () => {
    Object.entries(STAFF_OPERATION_TEXT).forEach(([key, text]) => {
      expect(Object.keys(text).sort(), key).toEqual(["en", "ja"]);
      expect(text.ja.trim(), `${key}.ja`).not.toBe("");
      expect(text.en.trim(), `${key}.en`).not.toBe("");
      expect([...text.en.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort(), key)
        .toEqual([...text.ja.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort());
      expect(/[\u3040-\u30ff\u3400-\u9fff]/u.test(text.en), `${key}.en`).toBe(false);
    });
  });

  it("interpolates user data without translating it", () => {
    expect(getStaffOperationText("approveConfirm", "en", { customerName: "株式会社 海" }))
      .toBe("Approve the order for 株式会社 海?");
  });
});
