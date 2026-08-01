import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OPERATION_MESSAGES } from "../src/lib/operation-messages";
import { RETURN_TAG_LABELS } from "../src/lib/return-tag-labels";
import {
  TANK_ACTION_LABELS,
  TANK_STATUS_LABELS,
} from "../src/lib/tank-action-status-labels";
import {
  findStaleBaselineFingerprints,
  findUnmanagedJapanese,
  isLocaleManagedLine,
  listStaffI18nSourceFiles,
  readStaffI18nBaseline,
  scanStaffJapanese,
} from "./staff-i18n-scan";

const repositoryRoot = resolve(import.meta.dirname, "..");

const DISALLOWED_I18N_PACKAGES = [
  "@formatjs/intl",
  "i18next",
  "next-intl",
  "react-i18next",
  "react-intl",
] as const;

describe("staff locale dictionaries", () => {
  it.each([
    ["operation messages", OPERATION_MESSAGES],
    ["return tag labels", RETURN_TAG_LABELS],
    ["tank action labels", TANK_ACTION_LABELS],
    ["tank status labels", TANK_STATUS_LABELS],
  ])("keeps non-empty ja/en values in %s", (_name, table) => {
    Object.entries(table).forEach(([key, localized]) => {
      expect(Object.keys(localized).sort(), key).toEqual(["en", "ja"]);
      expect(localized.ja.trim(), `${key}.ja`).not.toBe("");
      expect(localized.en.trim(), `${key}.en`).not.toBe("");
    });
  });

  it("does not introduce a second i18n framework", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);
    expect(
      DISALLOWED_I18N_PACKAGES.filter((packageName) => installed.has(packageName)),
    ).toEqual([]);
  });
});

describe("staff Japanese residual enforcement", () => {
  it("covers the explicit staff production source inventory", () => {
    const files = listStaffI18nSourceFiles(repositoryRoot);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith("src/app/staff/layout.tsx"))).toBe(true);
    expect(files.some((file) => file.endsWith("src/components/StaffAuthGuard.tsx"))).toBe(true);
    expect(files.every((file) => !file.includes(".test."))).toBe(true);
  });

  it("rejects Japanese occurrences outside the exact fingerprint baseline", () => {
    const baseline = readStaffI18nBaseline(repositoryRoot);
    const occurrences = scanStaffJapanese(repositoryRoot);
    const unmanaged = findUnmanagedJapanese(occurrences, baseline);
    expect(
      unmanaged.map(({ path, line, text }) => `${path}:${line} ${text}`),
    ).toEqual([]);

    if (baseline.strict) {
      expect(findStaleBaselineFingerprints(occurrences, baseline)).toEqual([]);
    }
  });

  it("recognizes only explicit ja dictionary and locale branches as managed copy", () => {
    expect(isLocaleManagedLine('title: { ja: "見出し", en: "Heading" }')).toBe(true);
    expect(isLocaleManagedLine('locale === "ja" ? "保存" : "Save"')).toBe(true);
    expect(isLocaleManagedLine('<button>保存</button>')).toBe(false);
  });
});
