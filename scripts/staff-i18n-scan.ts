import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const STAFF_I18N_SOURCE_ROOTS = [
  "src/app/staff",
  "src/features/inhouse",
  "src/features/maintenance",
  "src/features/procurement",
  "src/features/staff-dashboard",
  "src/features/staff-operations",
] as const;

export const STAFF_I18N_SHARED_FILES = [
  "src/components/DrumRoll.tsx",
  "src/components/MaintenanceTabs.tsx",
  "src/components/PrefixNumberPicker.tsx",
  "src/components/ProcurementTabs.tsx",
  "src/components/QuickSelect.tsx",
  "src/components/ReturnTagSelector.tsx",
  "src/components/StaffAuthGuard.tsx",
  "src/components/StaffJoinRequestPanel.tsx",
  "src/components/StaffSectionTabs.tsx",
  "src/components/TankIdInput.tsx",
  "src/hooks/useInspectionSettings.ts",
  "src/hooks/usePendingOrderCount.ts",
  "src/hooks/useStaffProfile.ts",
  "src/hooks/useStaffSession.ts",
  "src/hooks/useTankDataRevision.ts",
  "src/hooks/useTankOperationPolicy.ts",
  "src/hooks/useTanks.ts",
  "src/lib/customer-identity-read.ts",
  "src/lib/firebase/staff-locale-service.ts",
  "src/lib/operation-messages.ts",
  "src/lib/return-tag-labels.ts",
  "src/lib/staff-operation-error.ts",
  "src/lib/tank-action-status-labels.ts",
  "src/lib/tank-recovery-confirmation-message.ts",
] as const;

const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff々〆〤ヶ]/u;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE_PATTERN = /(?:^|\.)test\.tsx?$/u;
const BASELINE_PATH = "scripts/staff-i18n-baseline.json";

export type StaffJapaneseOccurrence = Readonly<{
  path: string;
  line: number;
  text: string;
  fingerprint: string;
}>;

export type StaffI18nBaseline = Readonly<{
  version: 1;
  strict: boolean;
  fingerprints: readonly string[];
}>;

export function listStaffI18nSourceFiles(repositoryRoot: string): string[] {
  const files = new Set<string>();

  STAFF_I18N_SOURCE_ROOTS.forEach((sourceRoot) => {
    const absoluteRoot = resolve(repositoryRoot, sourceRoot);
    if (!existsSync(absoluteRoot)) return;
    walkSourceFiles(absoluteRoot).forEach((file) => files.add(file));
  });

  STAFF_I18N_SHARED_FILES.forEach((sharedFile) => {
    const absoluteFile = resolve(repositoryRoot, sharedFile);
    if (existsSync(absoluteFile)) files.add(absoluteFile);
  });

  return [...files].sort();
}

export function scanStaffJapanese(
  repositoryRoot: string,
): StaffJapaneseOccurrence[] {
  const seenByStableText = new Map<string, number>();
  const occurrences: StaffJapaneseOccurrence[] = [];

  listStaffI18nSourceFiles(repositoryRoot).forEach((absolutePath) => {
    const repositoryPath = toRepositoryPath(repositoryRoot, absolutePath);
    const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/u);

    lines.forEach((lineText, index) => {
      if (!JAPANESE_TEXT_PATTERN.test(lineText)) return;
      const text = lineText.trim().replace(/\s+/gu, " ");
      const stableText = `${repositoryPath}\0${text}`;
      const duplicateIndex = seenByStableText.get(stableText) ?? 0;
      seenByStableText.set(stableText, duplicateIndex + 1);
      const fingerprint = createHash("sha256")
        .update(`${stableText}\0${duplicateIndex}`)
        .digest("hex");

      occurrences.push({
        path: repositoryPath,
        line: index + 1,
        text,
        fingerprint,
      });
    });
  });

  return occurrences;
}

export function readStaffI18nBaseline(repositoryRoot: string): StaffI18nBaseline {
  const raw = JSON.parse(
    readFileSync(resolve(repositoryRoot, BASELINE_PATH), "utf8"),
  ) as unknown;

  if (!isStaffI18nBaseline(raw)) {
    throw new Error(`${BASELINE_PATH} has an invalid shape.`);
  }
  return raw;
}

export function findUnmanagedJapanese(
  occurrences: readonly StaffJapaneseOccurrence[],
  baseline: StaffI18nBaseline,
): StaffJapaneseOccurrence[] {
  const allowed = new Set(baseline.fingerprints);
  return occurrences.filter(
    (occurrence) => !isLocaleManagedLine(occurrence.text)
      && !allowed.has(occurrence.fingerprint),
  );
}

export function findStaleBaselineFingerprints(
  occurrences: readonly StaffJapaneseOccurrence[],
  baseline: StaffI18nBaseline,
): string[] {
  const current = new Set(
    occurrences
      .filter((occurrence) => !isLocaleManagedLine(occurrence.text))
      .map((occurrence) => occurrence.fingerprint),
  );
  return baseline.fingerprints.filter((fingerprint) => !current.has(fingerprint));
}

export function isLocaleManagedLine(text: string): boolean {
  return /(?:\bja\s*:|locale\s*={2,3}\s*["']ja["'])/u.test(text);
}

function walkSourceFiles(directory: string): string[] {
  const files: string[] = [];
  readdirSync(directory).forEach((entry) => {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...walkSourceFiles(absolutePath));
      return;
    }
    if (!SOURCE_EXTENSIONS.has(extname(entry)) || TEST_FILE_PATTERN.test(entry)) return;
    files.push(absolutePath);
  });
  return files;
}

function toRepositoryPath(repositoryRoot: string, absolutePath: string): string {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

function isStaffI18nBaseline(value: unknown): value is StaffI18nBaseline {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StaffI18nBaseline>;
  return candidate.version === 1
    && typeof candidate.strict === "boolean"
    && Array.isArray(candidate.fingerprints)
    && candidate.fingerprints.every((fingerprint) => typeof fingerprint === "string");
}

export function writeCurrentBaseline(repositoryRoot: string): void {
  const { strict } = readStaffI18nBaseline(repositoryRoot);
  const occurrences = scanStaffJapanese(repositoryRoot);
  const baseline: StaffI18nBaseline = {
    version: 1,
    strict,
    fingerprints: occurrences
      .filter((occurrence) => !isLocaleManagedLine(occurrence.text))
      .map((occurrence) => occurrence.fingerprint)
      .sort(),
  };
  writeFileSync(
    resolve(repositoryRoot, BASELINE_PATH),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
  process.stdout.write(
    `Wrote ${baseline.fingerprints.length} fingerprints to ${BASELINE_PATH}.\n`,
  );
}

function printCurrentReport(repositoryRoot: string): void {
  const baseline = readStaffI18nBaseline(repositoryRoot);
  const occurrences = scanStaffJapanese(repositoryRoot);
  const unmanaged = findUnmanagedJapanese(occurrences, baseline);
  const stale = findStaleBaselineFingerprints(occurrences, baseline);
  process.stdout.write(
    `${JSON.stringify({
      files: listStaffI18nSourceFiles(repositoryRoot).length,
      occurrences: occurrences.length,
      unmanaged: unmanaged.map(({ path, line, text, fingerprint }) => ({
        path,
        line,
        text,
        fingerprint,
      })),
      staleBaselineCount: stale.length,
      strict: baseline.strict,
    }, null, 2)}\n`,
  );
}

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.includes("--write-baseline")) {
    writeCurrentBaseline(repositoryRoot);
  } else {
    printCurrentReport(repositoryRoot);
  }
}
