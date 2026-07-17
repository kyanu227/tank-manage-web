import { createHash } from "node:crypto";
import { canonicalSha256 } from "./canonical-firestore-value";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export type RulesReadinessEvidenceV1 = {
  version: 1;
  kind: "rules-baseline";
  generatedAt: string;
  projectId: string;
  mainCommit: string;
  principalSha256: string;
  payload: {
    matched: true;
    releaseId: "cloud.firestore";
    releaseUpdateTime: string;
    rulesetId: string;
    normalizedSha256: string;
    normalizedBytes: number;
  };
  evidenceSha256: string;
};

export type DataReadinessEvidenceV1 = {
  version: 1;
  kind: "data-preflight";
  generatedAt: string;
  projectId: string;
  databaseId: string;
  databaseUid: string;
  mainCommit: string;
  principalSha256: string;
  payload: {
    counts: { tanks: number; tankLogs: number; transactions: number };
    statusCounts: Record<string, number>;
    writes: number;
    requestBytes: number;
    sourceCensusSha256: string;
    documentPathSha256: string;
  };
  evidenceSha256: string;
};

export type CutoverReadinessEvidence =
  | RulesReadinessEvidenceV1
  | DataReadinessEvidenceV1;

export function principalSha256(principal: string): string {
  const normalized = principal.trim().toLowerCase();
  if (!normalized) throw new Error("principalが空です");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function createRulesReadinessEvidence(input: {
  generatedAt: string;
  projectId: string;
  mainCommit: string;
  principal: string;
  payload: RulesReadinessEvidenceV1["payload"];
}): RulesReadinessEvidenceV1 {
  const evidenceWithoutHash = {
    version: 1 as const,
    kind: "rules-baseline" as const,
    generatedAt: requireTimestamp(input.generatedAt, "generatedAt"),
    projectId: requireProjectId(input.projectId),
    mainCommit: requireGitSha(input.mainCommit),
    principalSha256: principalSha256(input.principal),
    payload: normalizeRulesPayload(input.payload),
  };
  return {
    ...evidenceWithoutHash,
    evidenceSha256: canonicalSha256(evidenceWithoutHash),
  };
}

export function createDataReadinessEvidence(input: {
  generatedAt: string;
  projectId: string;
  databaseId: string;
  databaseUid: string;
  mainCommit: string;
  principal: string;
  payload: DataReadinessEvidenceV1["payload"];
}): DataReadinessEvidenceV1 {
  const evidenceWithoutHash = {
    version: 1 as const,
    kind: "data-preflight" as const,
    generatedAt: requireTimestamp(input.generatedAt, "generatedAt"),
    projectId: requireProjectId(input.projectId),
    databaseId: requireNonEmptyString(input.databaseId, "databaseId"),
    databaseUid: requireNonEmptyString(input.databaseUid, "databaseUid"),
    mainCommit: requireGitSha(input.mainCommit),
    principalSha256: principalSha256(input.principal),
    payload: normalizeDataPayload(input.payload),
  };
  return {
    ...evidenceWithoutHash,
    evidenceSha256: canonicalSha256(evidenceWithoutHash),
  };
}

export function parseCutoverReadinessEvidence(value: unknown): CutoverReadinessEvidence {
  const record = objectRecord(value, "readiness evidence");
  if (record.version !== 1) throw new Error("readiness evidence versionが不正です");
  if (record.kind === "rules-baseline") return parseRulesEvidence(record);
  if (record.kind === "data-preflight") return parseDataEvidence(record);
  throw new Error("readiness evidence kindが不正です");
}

export function assertFreshReadinessEvidence(input: {
  evidence: CutoverReadinessEvidence;
  expectedProjectId: string;
  expectedMainCommit: string;
  expectedPrincipal: string;
  now: Date;
  maxAgeMs?: number;
}): void {
  const maxAgeMs = input.maxAgeMs ?? 15 * 60 * 1_000;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error("readiness evidenceの有効期間が不正です");
  }
  if (input.evidence.projectId !== input.expectedProjectId) {
    throw new Error("readiness evidenceのprojectが一致しません");
  }
  if (input.evidence.mainCommit !== input.expectedMainCommit) {
    throw new Error("readiness evidenceのmain commitが一致しません");
  }
  if (input.evidence.principalSha256 !== principalSha256(input.expectedPrincipal)) {
    throw new Error("readiness evidenceのprincipalが一致しません");
  }
  const generatedAt = Date.parse(input.evidence.generatedAt);
  const age = input.now.getTime() - generatedAt;
  if (age < 0 || age > maxAgeMs) {
    throw new Error("readiness evidenceが期限外です");
  }
}

function parseRulesEvidence(record: Record<string, unknown>): RulesReadinessEvidenceV1 {
  assertExactKeys(record, [
    "version", "kind", "generatedAt", "projectId", "mainCommit",
    "principalSha256", "payload", "evidenceSha256",
  ], "Rules readiness evidence");
  const withoutHash = {
    version: 1 as const,
    kind: "rules-baseline" as const,
    generatedAt: requireTimestamp(record.generatedAt, "generatedAt"),
    projectId: requireProjectId(record.projectId),
    mainCommit: requireGitSha(record.mainCommit),
    principalSha256: requireSha256(record.principalSha256, "principalSha256"),
    payload: normalizeRulesPayload(record.payload),
  };
  const evidenceSha256 = requireSha256(record.evidenceSha256, "evidenceSha256");
  if (canonicalSha256(withoutHash) !== evidenceSha256) {
    throw new Error("Rules readiness evidence hashが一致しません");
  }
  return { ...withoutHash, evidenceSha256 };
}

function parseDataEvidence(record: Record<string, unknown>): DataReadinessEvidenceV1 {
  assertExactKeys(record, [
    "version", "kind", "generatedAt", "projectId", "databaseId", "databaseUid",
    "mainCommit", "principalSha256", "payload", "evidenceSha256",
  ], "data readiness evidence");
  const withoutHash = {
    version: 1 as const,
    kind: "data-preflight" as const,
    generatedAt: requireTimestamp(record.generatedAt, "generatedAt"),
    projectId: requireProjectId(record.projectId),
    databaseId: requireNonEmptyString(record.databaseId, "databaseId"),
    databaseUid: requireNonEmptyString(record.databaseUid, "databaseUid"),
    mainCommit: requireGitSha(record.mainCommit),
    principalSha256: requireSha256(record.principalSha256, "principalSha256"),
    payload: normalizeDataPayload(record.payload),
  };
  const evidenceSha256 = requireSha256(record.evidenceSha256, "evidenceSha256");
  if (canonicalSha256(withoutHash) !== evidenceSha256) {
    throw new Error("data readiness evidence hashが一致しません");
  }
  return { ...withoutHash, evidenceSha256 };
}

function normalizeRulesPayload(value: unknown): RulesReadinessEvidenceV1["payload"] {
  const payload = objectRecord(value, "Rules evidence payload");
  assertExactKeys(payload, [
    "matched", "releaseId", "releaseUpdateTime", "rulesetId",
    "normalizedSha256", "normalizedBytes",
  ], "Rules evidence payload");
  if (payload.matched !== true || payload.releaseId !== "cloud.firestore") {
    throw new Error("Rules evidenceの一致状態が不正です");
  }
  return {
    matched: true,
    releaseId: "cloud.firestore",
    releaseUpdateTime: requireTimestamp(payload.releaseUpdateTime, "releaseUpdateTime"),
    rulesetId: requireNonEmptyString(payload.rulesetId, "rulesetId"),
    normalizedSha256: requireSha256(payload.normalizedSha256, "normalizedSha256"),
    normalizedBytes: requirePositiveInteger(payload.normalizedBytes, "normalizedBytes"),
  };
}

function normalizeDataPayload(value: unknown): DataReadinessEvidenceV1["payload"] {
  const payload = objectRecord(value, "data evidence payload");
  assertExactKeys(payload, [
    "counts", "statusCounts", "writes", "requestBytes",
    "sourceCensusSha256", "documentPathSha256",
  ], "data evidence payload");
  const counts = objectRecord(payload.counts, "data evidence counts");
  assertExactKeys(counts, ["tanks", "tankLogs", "transactions"], "data evidence counts");
  const statusCountsInput = objectRecord(payload.statusCounts, "statusCounts");
  const statusCounts = Object.fromEntries(Object.entries(statusCountsInput).map(([status, count]) => {
    if (!status || status !== status.trim()) throw new Error("statusCountsのstatusが不正です");
    return [status, requireNonNegativeInteger(count, `statusCounts.${status}`)];
  }));
  const normalizedCounts = {
    tanks: requireNonNegativeInteger(counts.tanks, "counts.tanks"),
    tankLogs: requireNonNegativeInteger(counts.tankLogs, "counts.tankLogs"),
    transactions: requireNonNegativeInteger(counts.transactions, "counts.transactions"),
  };
  if (Object.values(statusCounts).reduce((sum, count) => sum + count, 0) !== normalizedCounts.tanks) {
    throw new Error("statusCounts合計がtank件数と一致しません");
  }
  return {
    counts: normalizedCounts,
    statusCounts,
    writes: requirePositiveInteger(payload.writes, "writes"),
    requestBytes: requirePositiveInteger(payload.requestBytes, "requestBytes"),
    sourceCensusSha256: requireSha256(payload.sourceCensusSha256, "sourceCensusSha256"),
    documentPathSha256: requireSha256(payload.documentPathSha256, "documentPathSha256"),
  };
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}がobjectではありません`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}のfieldが不正です`);
  }
}

function requireProjectId(value: unknown): string {
  const projectId = requireNonEmptyString(value, "projectId");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    throw new Error("projectIdが不正です");
  }
  return projectId;
}

function requireGitSha(value: unknown): string {
  const sha = requireNonEmptyString(value, "mainCommit");
  if (!GIT_SHA_PATTERN.test(sha)) throw new Error("mainCommitが不正です");
  return sha;
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireNonEmptyString(value, label);
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label}が不正です`);
  return digest;
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireNonEmptyString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u.exec(
    timestamp,
  );
  if (!match) throw new Error(`${label}はcanonical RFC3339 UTCではありません`);
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  const parsed = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  ));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    throw new Error(`${label}はcanonical RFC3339 UTCではありません`);
  }
  return timestamp;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label}が不正です`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label}が不正です`);
  return Number(value);
}

function requirePositiveInteger(value: unknown, label: string): number {
  const number = requireNonNegativeInteger(value, label);
  if (number === 0) throw new Error(`${label}が不正です`);
  return number;
}
