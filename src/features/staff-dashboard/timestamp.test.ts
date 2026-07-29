import { describe, expect, it } from "vitest";
import { timestampToMillis, toDate } from "./timestamp";

describe("staff dashboard timestamp", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["false", false],
    ["zero", 0],
    ["NaN", Number.NaN],
  ])("%sはnullに変換する", (_label, value) => {
    expect(toDate(value)).toBeNull();
    expect(timestampToMillis(value)).toBeNull();
  });

  it("有限numberをDateとmillisに変換する", () => {
    const millis = 1_722_225_845_000;

    expect(toDate(millis)?.getTime()).toBe(millis);
    expect(timestampToMillis(millis)).toBe(millis);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "%sはInvalid DateとNaNに変換する",
    (value) => {
      const date = toDate(value);

      expect(date).toBeInstanceOf(Date);
      expect(Number.isNaN(date?.getTime())).toBe(true);
      expect(Number.isNaN(timestampToMillis(value))).toBe(true);
    },
  );

  it("有効なDateを同じinstanceのまま返す", () => {
    const value = new Date(1_722_225_845_000);

    expect(toDate(value)).toBe(value);
    expect(timestampToMillis(value)).toBe(value.getTime());
  });

  it("Invalid Dateを同じinstanceのまま返しmillisはNaNにする", () => {
    const value = new Date(Number.NaN);

    expect(toDate(value)).toBe(value);
    expect(Number.isNaN(timestampToMillis(value))).toBe(true);
  });

  it("toDateをtoMillisより優先する", () => {
    const expected = new Date(1_722_225_845_000);
    let toMillisCalled = false;
    const value = {
      toDate: () => expected,
      toMillis: () => {
        toMillisCalled = true;
        return 0;
      },
    };

    expect(toDate(value)).toBe(expected);
    expect(timestampToMillis(value)).toBe(expected.getTime());
    expect(toMillisCalled).toBe(false);
  });

  it("toMillisのみを持つobjectをDateとmillisに変換する", () => {
    const millis = 1_722_225_845_000;
    const value = {
      toMillis: () => millis,
    };

    expect(toDate(value)?.getTime()).toBe(millis);
    expect(timestampToMillis(value)).toBe(millis);
  });

  it("有効なstringのhyphenをslashへ置換してDateに変換する", () => {
    const value = "2026-07-29 12:34:56";
    const expectedMillis = new Date("2026/07/29 12:34:56").getTime();

    expect(toDate(value)?.getTime()).toBe(expectedMillis);
    expect(timestampToMillis(value)).toBe(expectedMillis);
  });

  it("無効なstringはnullに変換する", () => {
    expect(toDate("not-a-date")).toBeNull();
    expect(timestampToMillis("not-a-date")).toBeNull();
  });

  it("toDateのthrowを呼び出し元へ伝播する", () => {
    const failure = new Error("toDate failed");
    const value = {
      toDate: () => {
        throw failure;
      },
    };

    expect(() => toDate(value)).toThrow(failure);
    expect(() => timestampToMillis(value)).toThrow(failure);
  });

  it("toMillisのthrowを呼び出し元へ伝播する", () => {
    const failure = new Error("toMillis failed");
    const value = {
      toMillis: () => {
        throw failure;
      },
    };

    expect(() => toDate(value)).toThrow(failure);
    expect(() => timestampToMillis(value)).toThrow(failure);
  });
});
