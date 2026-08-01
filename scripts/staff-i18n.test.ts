import { describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OPERATION_MESSAGES } from "../src/lib/operation-messages";
import { RETURN_TAG_LABELS } from "../src/lib/return-tag-labels";
import {
  TANK_ACTION_LABELS,
  TANK_STATUS_LABELS,
} from "../src/lib/tank-action-status-labels";
import { TANK_RECOVERY_CONFIRMATION_TEXT } from "../src/lib/tank-recovery-confirmation-message";
import {
  findStaleBaselineFingerprints,
  findUnmanagedJapanese,
  isLocaleManagedLine,
  listStaffI18nSourceFiles,
  readStaffI18nBaseline,
  scanStaffJapanese,
  writeCurrentBaseline,
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
    ["tank recovery confirmation", TANK_RECOVERY_CONFIRMATION_TEXT],
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
    expect(baseline.strict).toBe(true);
    const occurrences = scanStaffJapanese(repositoryRoot);
    const unmanaged = findUnmanagedJapanese(occurrences, baseline);
    expect(
      unmanaged.map(({ path, line, text }) => `${path}:${line} ${text}`),
    ).toEqual([]);

    expect(findStaleBaselineFingerprints(occurrences, baseline)).toEqual([]);
  });

  it.each([true, false])(
    "preserves strict=%s when regenerating the baseline",
    (strict) => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), "staff-i18n-baseline-"));
      const stdoutWrite = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      try {
        mkdirSync(resolve(temporaryRoot, "scripts"));
        writeFileSync(
          resolve(temporaryRoot, "scripts/staff-i18n-baseline.json"),
          `${JSON.stringify({ version: 1, strict, fingerprints: ["old"] })}\n`,
        );

        writeCurrentBaseline(temporaryRoot);

        expect(readStaffI18nBaseline(temporaryRoot).strict).toBe(strict);
      } finally {
        stdoutWrite.mockRestore();
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it("recognizes only explicit ja dictionary and locale branches as managed copy", () => {
    expect(isLocaleManagedLine('title: { ja: "見出し", en: "Heading" }')).toBe(true);
    expect(isLocaleManagedLine('locale === "ja" ? "保存" : "Save"')).toBe(true);
    expect(isLocaleManagedLine('<button>保存</button>')).toBe(false);
  });
});
