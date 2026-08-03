import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import DrumRoll from "./DrumRoll";
import PrefixNumberPicker from "./PrefixNumberPicker";
import QuickSelect from "./QuickSelect";
import ReturnTagSelector from "./ReturnTagSelector";
import StaffJoinRequestPanel from "./StaffJoinRequestPanel";
import TankIdInput from "./TankIdInput";
import { getMaintenanceTabs } from "./MaintenanceTabs";
import { getProcurementTabs } from "./ProcurementTabs";

describe("shared staff locale UI", () => {
  it("keeps Japanese defaults and renders explicit English shared controls", () => {
    const noop = vi.fn();
    const quickJa = renderToStaticMarkup(createElement(QuickSelect, {
      options: ["A"], value: "", onChange: noop, color: "#000",
    }));
    const quickEn = renderToStaticMarkup(createElement(QuickSelect, {
      options: ["A"], value: "", onChange: noop, color: "#000", locale: "en",
    }));
    expect(quickJa).toContain("選択してください");
    expect(quickEn).toContain("Select an option");
    expect(quickJa).toContain('data-swipe-ignore="true"');

    const prefixEn = renderToStaticMarkup(createElement(PrefixNumberPicker, {
      tankIds: ["A-01"], value: null, onChange: noop, locale: "en",
    }));
    expect(prefixEn).toContain("Select a prefix");
    expect(prefixEn).toContain("Number");

    const drumEn = renderToStaticMarkup(createElement(DrumRoll, {
      items: ["A"], value: "A", onChange: noop, locale: "en",
    }));
    expect(drumEn).toContain('aria-label="Select a prefix"');
    expect(drumEn.match(/aria-selected="true"/gu)).toHaveLength(1);

    const tankInputEn = renderToStaticMarkup(createElement(TankIdInput, {
      prefixes: ["A"], activePrefix: null, onPrefixChange: noop,
      numberValue: "", onNumberChange: noop, onCommit: noop, locale: "en",
    }));
    expect(tankInputEn).toContain("Enter OK");
    expect(tankInputEn).toContain('aria-label="Tank number"');
    expect(tankInputEn).toContain('data-staff-swipe-surface="confirm"');
  });

  it("renders return tag labels without changing tag values", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(ReturnTagSelector, {
      value: "unused",
      onChange,
      options: [{ value: "unused", label: "未使用" }],
      locale: "en",
    }));
    expect(html).toContain("Unused");
    expect(html).not.toContain("未使用");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("localizes tab labels while preserving routes, order, icons, and colors", () => {
    for (const getTabs of [getMaintenanceTabs, getProcurementTabs]) {
      const ja = getTabs("ja");
      const en = getTabs("en");
      expect(en.map((tab) => tab.href)).toEqual(ja.map((tab) => tab.href));
      expect(en.map((tab) => tab.icon)).toEqual(ja.map((tab) => tab.icon));
      expect(en.map((tab) => tab.color)).toEqual(ja.map((tab) => tab.color));
      expect(en.every((tab) => !/[\u3040-\u30ff\u3400-\u9fff]/u.test(tab.label))).toBe(true);
    }
  });

  it("localizes the join request chrome and preserves user data", () => {
    const firebaseUser = {
      email: "山田@example.com",
      displayName: "山田 太郎",
    } as unknown as User;
    const html = renderToStaticMarkup(createElement(StaffJoinRequestPanel, {
      firebaseUser,
      locale: "en",
      onSubmit: vi.fn(),
    }));
    expect(html).toContain("Request staff access");
    expect(html).toContain("山田@example.com");
    expect(html).toContain('value="山田 太郎"');
    expect(html).not.toContain("スタッフ利用申請");
  });
});
