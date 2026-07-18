import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { canonicalSha256 } from "./canonical-firestore-value";
import { assertSafeSnapshotPath } from "./snapshot-envelope";
import {
  REQUIRED_HUMAN_CONFIRMATION_IDS,
  parseCutoverHumanEvidence,
  type CutoverHumanEvidence,
  type CutoverReadinessArguments,
} from "./infra-contract";
import type { CutoverInfraPlanReport } from "./cutover-infra-service";
import type { FirestoreRulesBaselineManifest } from "./firestore-rules-baseline";
import {
  assertFreshReadinessEvidence,
  parseCutoverReadinessEvidence,
  type DataReadinessEvidenceV1,
  type RulesReadinessEvidenceV1,
} from "./readiness-evidence";
import {
  probeProductionExecuteGatePosture,
  type ProductionExecuteGatePosture,
} from "./production-execute-gates";
import {
  PRODUCTION_CUTOVER_DATABASE_ID,
  PRODUCTION_CUTOVER_DATABASE_UID,
  PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
} from "./production-execution-contract";

const MAX_RESET_WRITES = 400;
const MAX_RESET_REQUEST_BYTES = 8 * 1024 * 1024;

export type CutoverReadinessReport = {
  status: "GO" | "NO-GO";
  completed: string[];
  blocking: string[];
  warnings: string[];
  humanConfirmationRequired: string[];
  evidenceHashes: Record<string, string>;
};

export async function loadReadinessEvidenceFiles(input: {
  args: CutoverReadinessArguments;
  repositoryRoot: string;
  /** test injection用。既定はOS account homeとし、ambient HOMEは使わない。 */
  homeDirectory?: string;
}): Promise<{
  human: CutoverHumanEvidence;
  rules: RulesReadinessEvidenceV1 | null;
  data: DataReadinessEvidenceV1 | null;
}> {
  const [humanValue, rulesValue, dataValue] = await Promise.all([
    readOptionalSafeJson(
      input.args.humanEvidencePath,
      input.repositoryRoot,
      input.args.snapshotDirectory,
      input.args.snapshotStorageMode,
      input.homeDirectory,
    ),
    readOptionalSafeJson(
      input.args.rulesBaselineEvidencePath,
      input.repositoryRoot,
      input.args.snapshotDirectory,
      input.args.snapshotStorageMode,
      input.homeDirectory,
    ),
    readOptionalSafeJson(
      input.args.dataPreflightEvidencePath,
      input.repositoryRoot,
      input.args.snapshotDirectory,
      input.args.snapshotStorageMode,
      input.homeDirectory,
    ),
  ]);
  const rulesEvidence = rulesValue === null ? null : parseCutoverReadinessEvidence(rulesValue);
  const dataEvidence = dataValue === null ? null : parseCutoverReadinessEvidence(dataValue);
  if (rulesEvidence && rulesEvidence.kind !== "rules-baseline") {
    throw new Error("Rules evidence fileのkindが不正です");
  }
  if (dataEvidence && dataEvidence.kind !== "data-preflight") {
    throw new Error("data evidence fileのkindが不正です");
  }
  return {
    human: parseCutoverHumanEvidence(humanValue),
    rules: rulesEvidence,
    data: dataEvidence,
  };
}

export function assessCutoverReadiness(input: {
  args: CutoverReadinessArguments;
  infra: CutoverInfraPlanReport | null;
  infraFailureCode?: string;
  human: CutoverHumanEvidence;
  rules: RulesReadinessEvidenceV1 | null;
  data: DataReadinessEvidenceV1 | null;
  productionExecuteGatePosture: ProductionExecuteGatePosture;
  expectedRulesBaseline: FirestoreRulesBaselineManifest;
  now: Date;
}): CutoverReadinessReport {
  const completed: string[] = [];
  const blocking: string[] = [];
  const warnings: string[] = [];
  const humanConfirmationRequired: string[] = [];
  const evidenceHashes: Record<string, string> = {};

  if (!input.infra) {
    blocking.push(input.infraFailureCode ?? "INFRA_PLAN_UNAVAILABLE");
  } else {
    evidenceHashes.infrastructure = input.infra.evidenceSha256;
    if (!sameStringSet(
      input.infra.humanConfirmationRequired,
      REQUIRED_HUMAN_CONFIRMATION_IDS,
    )) {
      blocking.push("INFRA_HUMAN_CONFIRMATION_CONTRACT_MISMATCH");
    }
    const unresolvedInfraReadinessBlockers = input.infra.readinessBlockers;
    warnings.push(...input.infra.warnings);
    if (input.infra.actions.length > 0) blocking.push("INFRA_ACTIONS_REMAIN");
    blocking.push(...input.infra.applyBlockers, ...unresolvedInfraReadinessBlockers);
    if (
      input.infra.actions.length === 0
      && input.infra.applyBlockers.length === 0
      && unresolvedInfraReadinessBlockers.length === 0
    ) completed.push("infrastructure contract is exact");
  }

  assessHumanEvidence({
    human: input.human,
    args: input.args,
    now: input.now,
    completed,
    blocking,
    warnings,
    required: humanConfirmationRequired,
  });
  evidenceHashes.human = canonicalSha256(input.human);

  if (!input.rules) {
    blocking.push("LIVE_RULES_BASELINE_EVIDENCE_MISSING");
  } else {
    try {
      assertFreshReadinessEvidence({
        evidence: input.rules,
        expectedProjectId: input.args.projectId,
        expectedMainCommit: input.args.expectedMainCommit,
        expectedPrincipal: input.args.rulesPrincipal,
        now: input.now,
      });
      const expectedReleaseId = resourceId(input.expectedRulesBaseline.releaseName);
      const expectedRulesetId = resourceId(input.expectedRulesBaseline.rulesetName);
      if (
        input.expectedRulesBaseline.projectId !== input.args.projectId
        || input.rules.payload.releaseId !== expectedReleaseId
        || input.rules.payload.releaseUpdateTime !== input.expectedRulesBaseline.releaseUpdateTime
        || input.rules.payload.rulesetId !== expectedRulesetId
        || input.rules.payload.normalizedSha256 !== input.expectedRulesBaseline.normalizedSha256
        || input.rules.payload.normalizedBytes !== input.expectedRulesBaseline.normalizedBytes
      ) {
        throw new Error("pinned Rules manifest mismatch");
      }
      completed.push("live Rules baseline evidence is fresh and pinned");
      evidenceHashes.rulesBaseline = input.rules.evidenceSha256;
    } catch {
      blocking.push("LIVE_RULES_BASELINE_EVIDENCE_INVALID_OR_STALE");
    }
  }

  if (!input.data) {
    blocking.push("PRODUCTION_DATA_PREFLIGHT_EVIDENCE_MISSING");
  } else {
    try {
      assertFreshReadinessEvidence({
        evidence: input.data,
        expectedProjectId: input.args.projectId,
        expectedMainCommit: input.args.expectedMainCommit,
        expectedPrincipal: input.args.dataPrincipal,
        now: input.now,
      });
      if (
        input.data.databaseId !== input.args.databaseId
        || input.data.databaseUid !== input.args.expectedDatabaseUid
      ) throw new Error("database mismatch");
      const expectedWrites = input.data.payload.counts.tanks
        + input.data.payload.counts.tankLogs
        + input.data.payload.counts.transactions
        + 1;
      if (
        input.data.payload.counts.tanks <= 0
        || input.data.payload.writes !== expectedWrites
        || input.data.payload.writes > MAX_RESET_WRITES
        || input.data.payload.requestBytes > MAX_RESET_REQUEST_BYTES
      ) throw new Error("reset bounds mismatch");
      const statusCountTotal = Object.values(input.data.payload.statusCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      if (statusCountTotal !== input.data.payload.counts.tanks) {
        throw new Error("status counts mismatch");
      }
      completed.push("production document preflight evidence is fresh and bounded");
      evidenceHashes.dataPreflight = input.data.evidenceSha256;
    } catch {
      blocking.push("PRODUCTION_DATA_PREFLIGHT_EVIDENCE_INVALID_OR_STALE");
    }
  }

  if (input.productionExecuteGatePosture === "closed") {
    completed.push("production reset and restore execute gates remain closed");
  } else if (input.productionExecuteGatePosture === "armed_for_fixed_transition_v1") {
    if (
      input.args.expectedOperatorPrincipal === PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL
      && input.args.databaseId === PRODUCTION_CUTOVER_DATABASE_ID
      && input.args.expectedDatabaseUid === PRODUCTION_CUTOVER_DATABASE_UID
    ) {
      completed.push("production execute gates are armed for the fixed transition v1 contract");
    } else {
      blocking.push("PRODUCTION_EXECUTE_CONTRACT_CONTEXT_MISMATCH");
    }
  } else {
    blocking.push("PRODUCTION_EXECUTE_GATE_POSTURE_UNSAFE");
  }

  const normalizedBlocking = uniqueSorted(blocking);
  return {
    status: normalizedBlocking.length === 0 ? "GO" : "NO-GO",
    completed: uniqueSorted(completed),
    blocking: normalizedBlocking,
    warnings: uniqueSorted(warnings),
    humanConfirmationRequired: uniqueSorted(humanConfirmationRequired),
    evidenceHashes,
  };
}

export async function productionExecuteGatePosture(
  repositoryRoot: string,
): Promise<ProductionExecuteGatePosture> {
  // repositoryRootを解決できることも確認し、別worktreeからの誤集約を拒否する。
  await realpath(repositoryRoot);
  return probeProductionExecuteGatePosture();
}

/** 別repositoryの同一SHAをreadiness正本として誤用しない。 */
export function isExpectedCutoverOriginRemote(remoteUrl: string): boolean {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)kyanu227\/tank-manage-web(?:\.git)?\/?$/u
    .test(remoteUrl.trim());
}

export function formatCutoverReadinessReport(report: CutoverReadinessReport): string {
  const section = (title: string, values: readonly string[]): string => [
    `${title}:`,
    ...(values.length > 0 ? values.map((value) => `- ${value}`) : ["- none"]),
  ].join("\n");
  return [
    `Cutover readiness: ${report.status}`,
    "",
    section("Completed", report.completed),
    "",
    section("Blocking", report.blocking),
    "",
    section("Warnings", report.warnings),
    "",
    section("Human confirmation required", report.humanConfirmationRequired),
    "",
    section("Evidence hashes", Object.entries(report.evidenceHashes).map(
      ([name, hash]) => `${name}: ${hash}`,
    )),
  ].join("\n");
}

async function readOptionalSafeJson(
  path: string | undefined,
  repositoryRoot: string,
  evidenceDirectory: string,
  storageMode: CutoverReadinessArguments["snapshotStorageMode"],
  homeDirectory?: string,
): Promise<unknown | null> {
  if (!path) return null;
  const safePath = await assertSafeSnapshotPath(
    path,
    { repositoryRoot, storageMode, homeDirectory },
    true,
  );
  const safeDirectory = await realpath(evidenceDirectory);
  const nested = relative(safeDirectory, safePath);
  if (nested === "" || nested.startsWith("..") || isAbsolute(nested)) {
    throw new Error("readiness evidence fileは指定snapshot directory配下に置いてください");
  }
  const raw = await readFile(safePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) {
    throw new Error("readiness evidence fileがsize上限を超えています");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("readiness evidence fileが有効なJSONではありません");
  }
}

function assessHumanEvidence(input: {
  human: CutoverHumanEvidence;
  args: CutoverReadinessArguments;
  now: Date;
  completed: string[];
  blocking: string[];
  warnings: string[];
  required: string[];
}): void {
  const { human, completed, blocking, warnings, required } = input;
  const reviewedAt = human.reviewedAt === null ? Number.NaN : Date.parse(human.reviewedAt);
  const humanEvidenceAge = input.now.getTime() - reviewedAt;
  if (
    human.projectId !== input.args.projectId
    || human.mainCommit !== input.args.expectedMainCommit
    || human.keyId !== input.args.keyId
    || human.expectedOperatorPrincipal !== input.args.expectedOperatorPrincipal
    || human.rulesDeployPrincipal !== input.args.rulesDeployPrincipal
    || human.confirmedByPrincipal !== input.args.expectedOperatorPrincipal
    || !Number.isFinite(reviewedAt)
    || humanEvidenceAge < 0
    || humanEvidenceAge > 60 * 60 * 1_000
  ) {
    blocking.push("HUMAN_EVIDENCE_CONTEXT_INVALID_OR_STALE");
    required.push("record fresh human evidence for this project and main commit");
  }
  const confirmations = {
    externalWritersConfirmedAbsent: human.externalWritersConfirmedAbsent === true,
    otherPcAutomationConfirmedAbsent: human.otherPcAutomationConfirmedAbsent === true,
    maintenanceWindowApproved: human.maintenanceWindowApproved === true,
    productionUsageStarted: human.productionUsageStarted === false,
  };
  Object.entries(confirmations).forEach(([name, confirmed]) => {
    if (!confirmed) {
      blocking.push(`${name.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}_UNCONFIRMED`);
      required.push(`confirm ${name}`);
    }
  });
  if (
    input.args.snapshotStorageMode === "icloud_encrypted"
    && human.encryptedICloudSnapshotApproved !== true
  ) {
    blocking.push("ENCRYPTED_ICLOUD_SNAPSHOT_NOT_APPROVED");
    required.push("confirm encryptedICloudSnapshotApproved");
  }
  if (input.args.snapshotStorageMode === "local_encrypted") {
    warnings.push("EXTERNAL_APFS_COPY_AND_SEPARATE_MAC_KEY_DRILL_RECOMMENDED");
  } else {
    warnings.push("SEPARATE_MAC_KEY_RECOVERY_DRILL_RECOMMENDED");
  }
  if (required.length === 0) completed.push("all required human evidence is confirmed");
}

function resourceId(resourceName: string): string {
  return resourceName.slice(resourceName.lastIndexOf("/") + 1);
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
