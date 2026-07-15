import { createHash } from "node:crypto";
import type { VerifiedRulesReaderCredential } from "./migration-credential";

const FIREBASE_RULES_API_ROOT = "https://firebaserules.googleapis.com/v1";
const FIREBASE_RULES_REQUEST_TIMEOUT_MS = 30_000;
const FIREBASE_RULES_MAX_RESPONSE_BYTES = 512 * 1024;

export type FirestoreRulesBaselineManifest = {
  version: 1;
  projectId: string;
  releaseName: string;
  releaseCreateTime: string;
  releaseUpdateTime: string;
  rulesetName: string;
  rulesetCreateTime: string;
  rulesFile: "firestore.rules";
  gitCommit: string;
  normalizedSha256: string;
  normalizedBytes: number;
};

export type VerifiedLiveFirestoreRulesBaseline = {
  mode: "pre-freeze-live-rules-baseline-verification";
  matched: true;
  projectId: string;
  releaseId: "cloud.firestore";
  releaseCreateTime: string;
  releaseUpdateTime: string;
  rulesetId: string;
  rulesetCreateTime: string;
  gitCommit: string;
  normalizedSha256: string;
  normalizedBytes: number;
};

export type FirestoreRulesBaselineDependencies = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

type FirebaseRulesRelease = {
  name: string;
  rulesetName: string;
  createTime: string;
  updateTime: string;
};

type FirebaseRuleset = {
  name: string;
  createTime: string;
  source: string;
};

/**
 * Rules APIとGitで生じ得る改行表現だけを正規化する。
 * 空白、comment、Unicodeなど本文を構成する文字は変更しない。
 */
export function normalizeFirestoreRulesSource(source: string): string {
  if (typeof source !== "string" || !source) {
    throw new Error("Firestore Rules sourceが空です");
  }
  const lineFeedSource = source.replaceAll("\r\n", "\n");
  if (lineFeedSource.includes("\r") || lineFeedSource.includes("\0")) {
    throw new Error("Firestore Rules sourceの改行または文字が不正です");
  }
  return `${lineFeedSource.replace(/\n+$/u, "")}\n`;
}

export function normalizedFirestoreRulesSha256(source: string): string {
  return createHash("sha256")
    .update(normalizeFirestoreRulesSource(source), "utf8")
    .digest("hex");
}

export function parseFirestoreRulesBaselineManifest(
  value: unknown,
): FirestoreRulesBaselineManifest {
  if (!isObject(value)) throw new Error("Rules baseline manifestがobjectではありません");
  const expectedKeys = [
    "version",
    "projectId",
    "releaseName",
    "releaseCreateTime",
    "releaseUpdateTime",
    "rulesetName",
    "rulesetCreateTime",
    "rulesFile",
    "gitCommit",
    "normalizedSha256",
    "normalizedBytes",
  ].sort();
  if (!sameStrings(Object.keys(value).sort(), expectedKeys)) {
    throw new Error("Rules baseline manifestのfieldが不正です");
  }

  const projectId = requireProjectId(value.projectId);
  const releaseName = requireString(value.releaseName, "releaseName");
  const expectedReleaseName = `projects/${projectId}/releases/cloud.firestore`;
  if (releaseName !== expectedReleaseName) {
    throw new Error("Rules baseline manifestのreleaseNameがprojectと一致しません");
  }
  const rulesetName = requireRulesetName(value.rulesetName, projectId);
  const rulesFile = requireString(value.rulesFile, "rulesFile");
  if (rulesFile !== "firestore.rules") {
    throw new Error("Rules baseline manifestのrulesFileが不正です");
  }
  const gitCommit = requireString(value.gitCommit, "gitCommit");
  if (!/^[0-9a-f]{40}$/u.test(gitCommit)) {
    throw new Error("Rules baseline manifestのgitCommitが不正です");
  }
  const normalizedSha256 = requireString(value.normalizedSha256, "normalizedSha256");
  if (!/^[0-9a-f]{64}$/u.test(normalizedSha256)) {
    throw new Error("Rules baseline manifestのSHA-256が不正です");
  }
  if (!Number.isSafeInteger(value.normalizedBytes) || Number(value.normalizedBytes) <= 0) {
    throw new Error("Rules baseline manifestのbyte数が不正です");
  }
  if (value.version !== 1) throw new Error("Rules baseline manifest versionが不正です");

  return {
    version: 1,
    projectId,
    releaseName,
    releaseCreateTime: requireTimestamp(value.releaseCreateTime, "releaseCreateTime"),
    releaseUpdateTime: requireTimestamp(value.releaseUpdateTime, "releaseUpdateTime"),
    rulesetName,
    rulesetCreateTime: requireTimestamp(value.rulesetCreateTime, "rulesetCreateTime"),
    rulesFile,
    gitCommit,
    normalizedSha256,
    normalizedBytes: Number(value.normalizedBytes),
  };
}

export function assertPinnedFirestoreRulesArtifact(input: {
  manifest: FirestoreRulesBaselineManifest;
  baselineSource: string;
  gitSource: string;
}): void {
  const baseline = normalizeFirestoreRulesSource(input.baselineSource);
  const hash = createHash("sha256").update(baseline, "utf8").digest("hex");
  const bytes = Buffer.byteLength(baseline, "utf8");
  // repository artifactはrollbackへそのままdeployするため、Git正本とrawで一致させる。
  if (input.baselineSource !== input.gitSource) {
    throw new Error("Rules baseline fileがpinned Git commitと一致しません");
  }
  if (hash !== input.manifest.normalizedSha256 || bytes !== input.manifest.normalizedBytes) {
    throw new Error("Rules baseline fileがmanifestと一致しません");
  }
}

/** freeze deployの直前にだけ実行し、現在のlive Rulesがrollback正本と一致することを確認する。 */
export async function verifyLiveFirestoreRulesBaseline(
  input: {
    projectId: string;
    rulesReaderCredential: Pick<
      VerifiedRulesReaderCredential,
      "kind" | "accessTokenProvider"
    >;
    manifest: FirestoreRulesBaselineManifest;
    baselineSource: string;
    gitSource: string;
  },
  dependencies: FirestoreRulesBaselineDependencies = {},
): Promise<VerifiedLiveFirestoreRulesBaseline> {
  const projectId = requireProjectId(input.projectId);
  if (input.manifest.projectId !== projectId) {
    throw new Error("live Rulesのprojectがbaseline manifestと一致しません");
  }
  if (input.rulesReaderCredential.kind !== "rules_reader") {
    throw new Error("live Rules baseline検証にはRules reader credentialが必要です");
  }
  assertPinnedFirestoreRulesArtifact(input);

  let accessToken: string;
  try {
    accessToken = (await input.rulesReaderCredential.accessTokenProvider()).trim();
  } catch {
    throw new Error("live Rules取得用access tokenを取得できません");
  }
  if (!accessToken) throw new Error("live Rules取得用access tokenを取得できません");

  const request = createFirebaseRulesRequest({
    accessToken,
    fetchImpl: dependencies.fetch ?? fetch,
    timeoutMs: dependencies.timeoutMs ?? FIREBASE_RULES_REQUEST_TIMEOUT_MS,
    maxResponseBytes: dependencies.maxResponseBytes ?? FIREBASE_RULES_MAX_RESPONSE_BYTES,
  });
  const releasePath = `projects/${projectId}/releases/cloud.firestore`;
  const firstRelease = parseRelease(
    await request(releasePath),
    projectId,
  );
  const ruleset = parseRuleset(
    await request(firstRelease.rulesetName),
    projectId,
    firstRelease.rulesetName,
    input.manifest.rulesFile,
  );
  const secondRelease = parseRelease(
    await request(releasePath),
    projectId,
  );
  if (!sameRelease(firstRelease, secondRelease)) {
    throw new Error("live Rules releaseが検証中に変更されました");
  }

  const liveSource = normalizeFirestoreRulesSource(ruleset.source);
  const liveSha256 = createHash("sha256").update(liveSource, "utf8").digest("hex");
  const liveBytes = Buffer.byteLength(liveSource, "utf8");
  const baselineSource = normalizeFirestoreRulesSource(input.baselineSource);
  const metadataMatches = (
    firstRelease.name === input.manifest.releaseName
    && firstRelease.createTime === input.manifest.releaseCreateTime
    && firstRelease.updateTime === input.manifest.releaseUpdateTime
    && firstRelease.rulesetName === input.manifest.rulesetName
    && ruleset.name === input.manifest.rulesetName
    && ruleset.createTime === input.manifest.rulesetCreateTime
  );
  if (
    !metadataMatches
    || liveSource !== baselineSource
    || liveSha256 !== input.manifest.normalizedSha256
    || liveBytes !== input.manifest.normalizedBytes
  ) {
    throw new Error("live Rulesがpinned rollback baselineと一致しません");
  }

  return {
    mode: "pre-freeze-live-rules-baseline-verification",
    matched: true,
    projectId,
    releaseId: "cloud.firestore",
    releaseCreateTime: firstRelease.createTime,
    releaseUpdateTime: firstRelease.updateTime,
    rulesetId: firstRelease.rulesetName.slice(firstRelease.rulesetName.lastIndexOf("/") + 1),
    rulesetCreateTime: ruleset.createTime,
    gitCommit: input.manifest.gitCommit,
    normalizedSha256: liveSha256,
    normalizedBytes: liveBytes,
  };
}

function createFirebaseRulesRequest(options: {
  accessToken: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}): (resourceName: string) => Promise<unknown> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Firebase Rules API timeoutが不正です");
  }
  if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0) {
    throw new Error("Firebase Rules API response上限が不正です");
  }
  return async (resourceName) => {
    let response: Response;
    try {
      response = await options.fetchImpl(
        `${FIREBASE_RULES_API_ROOT}/${resourceName.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${options.accessToken}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(options.timeoutMs),
        },
      );
    } catch {
      throw new Error("Firebase Rules APIからlive Rulesを取得できません");
    }
    if (!response.ok) {
      // Error bodyにはsourceや診断情報が含まれ得るため読み込まない。
      throw new Error(`Firebase Rules APIからlive Rulesを取得できません (status=${response.status})`);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const declaredBytes = Number(contentLength);
      if (
        !Number.isSafeInteger(declaredBytes)
        || declaredBytes < 0
        || declaredBytes > options.maxResponseBytes
      ) {
        throw new Error("Firebase Rules API responseが上限を超えています");
      }
    }
    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new Error("Firebase Rules API responseを読み取れません");
    }
    if (Buffer.byteLength(responseText, "utf8") > options.maxResponseBytes) {
      throw new Error("Firebase Rules API responseが上限を超えています");
    }
    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      throw new Error("Firebase Rules API responseが不正です");
    }
  };
}

function parseRelease(value: unknown, projectId: string): FirebaseRulesRelease {
  if (!isObject(value)) throw new Error("Firebase Rules release responseが不正です");
  const expectedName = `projects/${projectId}/releases/cloud.firestore`;
  const name = requireString(value.name, "release.name");
  if (name !== expectedName) throw new Error("Firebase Rules releaseのprojectが一致しません");
  return {
    name,
    rulesetName: requireRulesetName(value.rulesetName, projectId),
    createTime: requireTimestamp(value.createTime, "release.createTime"),
    updateTime: requireTimestamp(value.updateTime, "release.updateTime"),
  };
}

function parseRuleset(
  value: unknown,
  projectId: string,
  expectedRulesetName: string,
  expectedRulesFile: string,
): FirebaseRuleset {
  if (!isObject(value)) throw new Error("Firebase Rules ruleset responseが不正です");
  const name = requireRulesetName(value.name, projectId);
  if (name !== expectedRulesetName) {
    throw new Error("Firebase Rules rulesetがreleaseと一致しません");
  }
  if (!isObject(value.source) || !Array.isArray(value.source.files)) {
    throw new Error("Firebase Rules ruleset sourceが不正です");
  }
  if (value.source.files.length !== 1 || !isObject(value.source.files[0])) {
    throw new Error("Firebase Rules ruleset source fileを一意に特定できません");
  }
  const file = value.source.files[0];
  if (file.name !== expectedRulesFile || typeof file.content !== "string" || !file.content) {
    throw new Error("Firebase Rules ruleset source fileが不正です");
  }
  return {
    name,
    createTime: requireTimestamp(value.createTime, "ruleset.createTime"),
    source: file.content,
  };
}

function sameRelease(left: FirebaseRulesRelease, right: FirebaseRulesRelease): boolean {
  return left.name === right.name
    && left.rulesetName === right.rulesetName
    && left.createTime === right.createTime
    && left.updateTime === right.updateTime;
}

function requireProjectId(value: unknown): string {
  const projectId = requireString(value, "projectId");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    throw new Error("Firebase Rules project IDが不正です");
  }
  return projectId;
}

function requireRulesetName(value: unknown, projectId: string): string {
  const name = requireString(value, "rulesetName");
  const prefix = `projects/${projectId}/rulesets/`;
  const id = name.startsWith(prefix) ? name.slice(prefix.length) : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) {
    throw new Error("Firebase Rules rulesetNameがexpected projectと一致しません");
  }
  return name;
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`${label}が不正です`);
  }
  return timestamp;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label}が不正です`);
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
