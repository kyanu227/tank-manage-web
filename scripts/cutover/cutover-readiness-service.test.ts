import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessCutoverReadiness,
  formatCutoverReadinessReport,
  isExpectedCutoverOriginRemote,
  loadReadinessEvidenceFiles,
} from "./cutover-readiness-service";
import {
  CUTOVER_INFRA_CONTRACT,
  REQUIRED_HUMAN_CONFIRMATION_IDS,
  parseCutoverHumanEvidence,
  type CutoverReadinessArguments,
} from "./infra-contract";
import type { CutoverInfraPlanReport } from "./cutover-infra-service";
import type { FirestoreRulesBaselineManifest } from "./firestore-rules-baseline";
import {
  createDataReadinessEvidence,
  createRulesReadinessEvidence,
} from "./readiness-evidence";
import {
  PRODUCTION_CUTOVER_DATABASE_ID,
  PRODUCTION_CUTOVER_DATABASE_UID,
  PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
} from "./production-execution-contract";

const NOW = new Date("2026-07-17T00:05:00.000Z");
const MAIN = "a".repeat(40);
const RULES_HASH = "b".repeat(64);
const RULES_BASELINE: FirestoreRulesBaselineManifest = {
  version: 1,
  projectId: CUTOVER_INFRA_CONTRACT.projectId,
  releaseName: `projects/${CUTOVER_INFRA_CONTRACT.projectId}/releases/cloud.firestore`,
  releaseCreateTime: "2026-03-11T07:36:20.560827Z",
  releaseUpdateTime: "2026-06-02T08:28:53.917Z",
  rulesetName: `projects/${CUTOVER_INFRA_CONTRACT.projectId}/rulesets/ruleset-id`,
  rulesetCreateTime: "2026-06-02T08:28:52.433311Z",
  rulesFile: "firestore.rules",
  gitCommit: "f".repeat(40),
  normalizedSha256: RULES_HASH,
  normalizedBytes: 100,
};

describe("cutover readiness assessment", () => {
  it("必須のmachine evidenceとuser confirmationが揃えばwarningがあってもGO", () => {
    const report = assessCutoverReadiness(readyInput());
    expect(report.status).toBe("GO");
    expect(report.blocking).toEqual([]);
    expect(report.humanConfirmationRequired).toEqual([]);
    expect(report.warnings).toEqual(expect.arrayContaining([
      "DATA_WRITE_AUDIT_LOGS_NOT_ENABLED",
      "EXTERNAL_APFS_COPY_AND_SEPARATE_MAC_KEY_DRILL_RECOMMENDED",
    ]));
    expect(formatCutoverReadinessReport(report)).toContain("Cutover readiness: GO");
    expect(formatCutoverReadinessReport(report)).toContain("Warnings:");
  });

  it("閉鎖中または固定one-time契約へのarmedだけを安全postureとして受理する", () => {
    const closed = assessCutoverReadiness({
      ...readyInput(),
      productionExecuteGatePosture: "closed",
    });
    expect(closed.status).toBe("GO");
    expect(closed.completed).toContain("production reset and restore execute gates remain closed");

    const unsafe = assessCutoverReadiness({
      ...readyInput(),
      productionExecuteGatePosture: "unsafe",
    });
    expect(unsafe.status).toBe("NO-GO");
    expect(unsafe.blocking).toContain("PRODUCTION_EXECUTE_GATE_POSTURE_UNSAFE");
  });

  it.each([
    ["operator", { expectedOperatorPrincipal: "user:other@example.com" }],
    ["database", { databaseId: "other-database" }],
    ["database UID", { expectedDatabaseUid: "other-database-uid" }],
  ] as const)("armed postureで%sがPhase 3固定契約と異なればNO-GO", (_label, change) => {
    const input = readyInput();
    const args = { ...input.args, ...change };
    const human = "expectedOperatorPrincipal" in change
      ? {
          ...input.human,
          expectedOperatorPrincipal: change.expectedOperatorPrincipal,
          confirmedByPrincipal: change.expectedOperatorPrincipal,
        }
      : input.human;
    const data = createDataReadinessEvidence({
      generatedAt: input.data!.generatedAt,
      projectId: args.projectId,
      databaseId: args.databaseId,
      databaseUid: args.expectedDatabaseUid,
      mainCommit: args.expectedMainCommit,
      principal: args.dataPrincipal,
      payload: input.data!.payload,
    });

    const report = assessCutoverReadiness({ ...input, args, human, data });

    expect(report.status).toBe("NO-GO");
    expect(report.blocking).toContain("PRODUCTION_EXECUTE_CONTRACT_CONTEXT_MISMATCH");
  });

  it.each([
    ["infra", null],
    ["rules", null],
    ["data", null],
    ["productionExecuteGatePosture", "unsafe"],
  ] as const)("%sが欠ければNO-GO", (key, value) => {
    const report = assessCutoverReadiness({ ...readyInput(), [key]: value });
    expect(report.status).toBe("NO-GO");
    expect(report.blocking.length).toBeGreaterThan(0);
  });

  it.each([
    ["externalWritersConfirmedAbsent", null, "EXTERNAL_WRITERS_CONFIRMED_ABSENT_UNCONFIRMED"],
    ["otherPcAutomationConfirmedAbsent", null, "OTHER_PC_AUTOMATION_CONFIRMED_ABSENT_UNCONFIRMED"],
    ["maintenanceWindowApproved", null, "MAINTENANCE_WINDOW_APPROVED_UNCONFIRMED"],
    ["productionUsageStarted", null, "PRODUCTION_USAGE_STARTED_UNCONFIRMED"],
    ["productionUsageStarted", true, "PRODUCTION_USAGE_STARTED_UNCONFIRMED"],
  ] as const)("必須user fact %s=%sを未確定のまま推測しない", (key, value, blocker) => {
    const input = readyInput();
    const report = assessCutoverReadiness({
      ...input,
      human: { ...input.human, [key]: value },
    });
    expect(report.status).toBe("NO-GO");
    expect(report.blocking).toContain(blocker);
  });

  it("iCloud modeは暗号化snapshotの承認を必須にする", () => {
    const input = readyInput("icloud_encrypted");
    const missingApproval = assessCutoverReadiness({
      ...input,
      human: {
        ...input.human,
        encryptedICloudSnapshotApproved: null,
      },
    });
    expect(missingApproval.status).toBe("NO-GO");
    expect(missingApproval.blocking).toContain("ENCRYPTED_ICLOUD_SNAPSHOT_NOT_APPROVED");

    const approved = assessCutoverReadiness(input);
    expect(approved.status).toBe("GO");
    expect(approved.warnings).toEqual(expect.arrayContaining([
      "ICLOUD_SNAPSHOT_REQUIRES_COMPLETE_DOWNLOAD_BEFORE_RESTORE",
      "SEPARATE_MAC_KEY_RECOVERY_DRILL_RECOMMENDED",
    ]));
  });

  it("stale evidenceとwrite count不整合をNO-GOにする", () => {
    const input = readyInput();
    const staleRules = { ...input.rules!, generatedAt: "2026-07-16T00:00:00.000Z" };
    const badData = createDataReadinessEvidence({
      generatedAt: "2026-07-17T00:00:00.000Z",
      projectId: input.args.projectId,
      databaseId: input.args.databaseId,
      databaseUid: input.args.expectedDatabaseUid,
      mainCommit: MAIN,
      principal: input.args.dataPrincipal,
      payload: {
        ...input.data!.payload,
        writes: 191,
      },
    });
    const report = assessCutoverReadiness({ ...input, rules: staleRules, data: badData });
    expect(report.blocking).toEqual(expect.arrayContaining([
      "LIVE_RULES_BASELINE_EVIDENCE_INVALID_OR_STALE",
      "PRODUCTION_DATA_PREFLIGHT_EVIDENCE_INVALID_OR_STALE",
    ]));
  });

  it("tank 0件のmarker-only planをNO-GOにする", () => {
    const input = readyInput();
    const data = createDataReadinessEvidence({
      generatedAt: input.data!.generatedAt,
      projectId: input.args.projectId,
      databaseId: input.args.databaseId,
      databaseUid: input.args.expectedDatabaseUid,
      mainCommit: MAIN,
      principal: input.args.dataPrincipal,
      payload: {
        ...input.data!.payload,
        counts: { tanks: 0, tankLogs: 0, transactions: 0 },
        statusCounts: {},
        writes: 1,
      },
    });
    const report = assessCutoverReadiness({ ...input, data });
    expect(report.blocking).toContain("PRODUCTION_DATA_PREFLIGHT_EVIDENCE_INVALID_OR_STALE");
  });

  it("human evidenceをproject・main・鮮度へ結び付け、operator本人の確認を受理する", () => {
    const input = readyInput();
    const staleHuman = {
      ...input.human,
      reviewedAt: "2026-07-16T00:00:00.000Z",
    };
    const stale = assessCutoverReadiness({ ...input, human: staleHuman });
    expect(stale.blocking).toContain("HUMAN_EVIDENCE_CONTEXT_INVALID_OR_STALE");

    const operatorConfirmed = assessCutoverReadiness({
      ...input,
      human: {
        ...input.human,
        confirmedByPrincipal: input.args.expectedOperatorPrincipal,
      },
    });
    expect(operatorConfirmed.status).toBe("GO");

    const differentConfirmer = assessCutoverReadiness({
      ...input,
      human: {
        ...input.human,
        confirmedByPrincipal: "user:other@example.com",
      },
    });
    expect(differentConfirmer.blocking).toContain("HUMAN_EVIDENCE_CONTEXT_INVALID_OR_STALE");
  });

  it.each([
    ["keyId", "other-key"],
    ["expectedOperatorPrincipal", "user:other-operator@example.com"],
    ["rulesDeployPrincipal", "user:other-rules-deployer@example.com"],
  ] as const)("human evidenceを実行contextの%sへ結び付ける", (key, value) => {
    const input = readyInput();
    const report = assessCutoverReadiness({
      ...input,
      human: { ...input.human, [key]: value },
    });
    expect(report.blocking).toContain("HUMAN_EVIDENCE_CONTEXT_INVALID_OR_STALE");
  });

  it.each([
    ["releaseId", { releaseName: `projects/${CUTOVER_INFRA_CONTRACT.projectId}/releases/other-release` }],
    ["releaseUpdateTime", { releaseUpdateTime: "2026-06-02T08:28:54.000Z" }],
    ["rulesetId", { rulesetName: `projects/${CUTOVER_INFRA_CONTRACT.projectId}/rulesets/other-ruleset` }],
    ["normalizedSha256", { normalizedSha256: "0".repeat(64) }],
    ["normalizedBytes", { normalizedBytes: 101 }],
  ] as const)("Rules evidenceの%sがpinned manifestと異なればNO-GO", (_label, change) => {
    const input = readyInput();
    const report = assessCutoverReadiness({
      ...input,
      expectedRulesBaseline: { ...RULES_BASELINE, ...change },
    });
    expect(report.blocking).toContain("LIVE_RULES_BASELINE_EVIDENCE_INVALID_OR_STALE");
  });
});

describe("cutover origin remote", () => {
  it.each([
    "https://github.com/kyanu227/tank-manage-web",
    "https://github.com/kyanu227/tank-manage-web.git",
    "git@github.com:kyanu227/tank-manage-web.git",
    "ssh://git@github.com/kyanu227/tank-manage-web.git",
  ])("canonical GitHub remoteを受理する: %s", (remoteUrl) => {
    expect(isExpectedCutoverOriginRemote(remoteUrl)).toBe(true);
  });

  it.each([
    "https://github.com/other/tank-manage-web.git",
    "https://github.com/kyanu227/other.git",
    "https://github.example.com/kyanu227/tank-manage-web.git",
    "file:///tmp/tank-manage-web",
  ])("別repository remoteを拒否する: %s", (remoteUrl) => {
    expect(isExpectedCutoverOriginRemote(remoteUrl)).toBe(false);
  });
});

describe("readiness evidence file storage", () => {
  it("iCloud cutover directory配下の0600 safe-summary evidenceを読み込む", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "cutover-readiness-icloud-")));
    const repositoryRoot = join(root, "repository");
    const homeDirectory = join(root, "os-home");
    const snapshotDirectory = join(
      homeDirectory,
      "Library",
      "Mobile Documents",
      "com~apple~CloudDocs",
      "TankCutover",
    );
    const humanEvidencePath = join(snapshotDirectory, "human-evidence.json");
    try {
      await mkdir(repositoryRoot);
      await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
      await writeFile(humanEvidencePath, JSON.stringify({
        version: 1,
        externalWritersConfirmedAbsent: true,
      }), { mode: 0o600 });
      const args: CutoverReadinessArguments = {
        ...readinessArgs(),
        snapshotDirectory,
        snapshotStorageMode: "icloud_encrypted",
        humanEvidencePath,
      };

      const loaded = await loadReadinessEvidenceFiles({
        args,
        repositoryRoot,
        homeDirectory,
      });

      expect(loaded.human.externalWritersConfirmedAbsent).toBe(true);
      expect(loaded.rules).toBeNull();
      expect(loaded.data).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function readyInput(
  snapshotStorageMode: CutoverReadinessArguments["snapshotStorageMode"] = "local_encrypted",
) {
  const args = readinessArgs(snapshotStorageMode);
  return {
    args,
    infra: exactInfraReport(snapshotStorageMode),
    human: parseCutoverHumanEvidence({
      version: 1,
      projectId: CUTOVER_INFRA_CONTRACT.projectId,
      mainCommit: MAIN,
      keyId: args.keyId,
      expectedOperatorPrincipal: args.expectedOperatorPrincipal,
      rulesDeployPrincipal: args.rulesDeployPrincipal,
      reviewedAt: "2026-07-17T00:00:00.000Z",
      confirmedByPrincipal: args.expectedOperatorPrincipal,
      externalWritersConfirmedAbsent: true,
      otherPcAutomationConfirmedAbsent: true,
      maintenanceWindowApproved: true,
      productionUsageStarted: false,
      encryptedICloudSnapshotApproved:
        snapshotStorageMode === "icloud_encrypted" ? true : undefined,
    }),
    rules: createRulesReadinessEvidence({
      generatedAt: "2026-07-17T00:00:00.000Z",
      projectId: args.projectId,
      mainCommit: MAIN,
      principal: args.rulesPrincipal,
      payload: {
        matched: true,
        releaseId: "cloud.firestore",
        releaseUpdateTime: "2026-06-02T08:28:53.917Z",
        rulesetId: "ruleset-id",
        normalizedSha256: RULES_HASH,
        normalizedBytes: 100,
      },
    }),
    data: createDataReadinessEvidence({
      generatedAt: "2026-07-17T00:00:00.000Z",
      projectId: args.projectId,
      databaseId: args.databaseId,
      databaseUid: args.expectedDatabaseUid,
      mainCommit: MAIN,
      principal: args.dataPrincipal,
      payload: {
        counts: { tanks: 145, tankLogs: 38, transactions: 8 },
        statusCounts: { empty: 145 },
        writes: 192,
        requestBytes: 80_200,
        sourceCensusSha256: "c".repeat(64),
        documentPathSha256: "d".repeat(64),
      },
    }),
    productionExecuteGatePosture: "armed_for_fixed_transition_v1" as const,
    expectedRulesBaseline: RULES_BASELINE,
    now: NOW,
  };
}

function readinessArgs(
  snapshotStorageMode: CutoverReadinessArguments["snapshotStorageMode"] = "local_encrypted",
): CutoverReadinessArguments {
  return {
    command: "readiness",
    projectId: CUTOVER_INFRA_CONTRACT.projectId,
    expectedOperatorPrincipal: PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
    rulesDeployPrincipal: "user:rules-deployer@example.com",
    bindingExpiresAt: "2026-07-17T12:00:00Z",
    keyId: "transition-v1",
    snapshotDirectory: "/private/tmp/cutover",
    snapshotStorageMode,
    dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
    rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
    expectedMainCommit: MAIN,
    databaseId: PRODUCTION_CUTOVER_DATABASE_ID,
    expectedDatabaseUid: PRODUCTION_CUTOVER_DATABASE_UID,
  };
}

function exactInfraReport(
  snapshotStorageMode: CutoverReadinessArguments["snapshotStorageMode"] = "local_encrypted",
): CutoverInfraPlanReport {
  return {
    mode: "read-only-infra-plan",
    project: { projectId: CUTOVER_INFRA_CONTRACT.projectId, projectNumber: "123", active: true },
    resources: {
      dataServiceAccount: "exact",
      rulesServiceAccount: "exact",
      dataCustomRole: "exact",
      rulesCustomRole: "exact",
      projectBindings: "exact",
      dataImpersonationBinding: "exact",
      rulesImpersonationBinding: "exact",
      dataWriteAuditLogs: "missing",
      snapshotKeychainEntry: "present",
      snapshotDirectory: snapshotStorageMode,
    },
    actions: [],
    applyBlockers: [],
    readinessBlockers: [],
    warnings: [
      "DATA_WRITE_AUDIT_LOGS_NOT_ENABLED",
      ...(snapshotStorageMode === "icloud_encrypted"
        ? ["ICLOUD_SNAPSHOT_REQUIRES_COMPLETE_DOWNLOAD_BEFORE_RESTORE"]
        : []),
    ],
    humanConfirmationRequired: [...REQUIRED_HUMAN_CONFIRMATION_IDS],
    credentialInventory: {
      fileCount: 0,
      serviceAccounts: [],
      uninspectableCandidateCount: 0,
      skippedSymlinkCount: 0,
    },
    evidenceSha256: "e".repeat(64),
  };
}
