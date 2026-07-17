import { describe, expect, it } from "vitest";
import {
  assessCutoverReadiness,
  formatCutoverReadinessReport,
  isExpectedCutoverOriginRemote,
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
  it("全machine evidenceとhuman confirmationが揃った場合だけGO", () => {
    const report = assessCutoverReadiness(readyInput());
    expect(report.status).toBe("GO");
    expect(report.blocking).toEqual([]);
    expect(report.humanConfirmationRequired).toEqual([]);
    expect(formatCutoverReadinessReport(report)).toContain("Cutover readiness: GO");
  });

  it.each([
    ["infra", null],
    ["rules", null],
    ["data", null],
    ["productionExecuteGatesClosed", false],
  ] as const)("%sが欠ければNO-GO", (key, value) => {
    const report = assessCutoverReadiness({ ...readyInput(), [key]: value });
    expect(report.status).toBe("NO-GO");
    expect(report.blocking.length).toBeGreaterThan(0);
  });

  it("GAS等を未回答のままabsentと推測しない", () => {
    const report = assessCutoverReadiness({
      ...readyInput(),
      human: parseCutoverHumanEvidence(undefined),
    });
    expect(report.status).toBe("NO-GO");
    expect(report.blocking).toContain("WRITER_GAS_UNKNOWN");
    expect(report.humanConfirmationRequired).toContain("confirm gas is absent or stopped");
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

  it("human evidenceをproject・main・鮮度・別reviewerへ結び付ける", () => {
    const input = readyInput();
    const staleHuman = {
      ...input.human,
      reviewedAt: "2026-07-16T00:00:00.000Z",
    };
    const stale = assessCutoverReadiness({ ...input, human: staleHuman });
    expect(stale.blocking).toContain("HUMAN_EVIDENCE_CONTEXT_INVALID_OR_STALE");

    const selfReviewed = assessCutoverReadiness({
      ...input,
      human: {
        ...input.human,
        reviewerPrincipal: input.args.expectedOperatorPrincipal,
      },
    });
    expect(selfReviewed.blocking).toContain("HUMAN_EVIDENCE_CONTEXT_INVALID_OR_STALE");
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

function readyInput() {
  const args = readinessArgs();
  return {
    args,
    infra: exactInfraReport(),
    human: parseCutoverHumanEvidence({
      version: 1,
      projectId: CUTOVER_INFRA_CONTRACT.projectId,
      mainCommit: MAIN,
      keyId: args.keyId,
      expectedOperatorPrincipal: args.expectedOperatorPrincipal,
      rulesDeployPrincipal: args.rulesDeployPrincipal,
      reviewedAt: "2026-07-17T00:00:00.000Z",
      reviewerPrincipal: "user:reviewer@example.com",
      writers: {
        cloud_functions: "absent",
        cloud_run_services: "absent",
        cloud_run_jobs: "absent",
        app_engine: "absent",
        cloud_scheduler: "absent",
        workflows: "absent",
        pubsub_eventarc_cloud_tasks: "absent",
        firebase_extensions: "absent",
        ci_other_repositories: "absent",
        local_scripts_cron: "confirmed_stopped",
        manual_rest_rpc: "confirmed_stopped",
        gas: "absent",
        make: "absent",
        zapier: "absent",
        other_computers: "confirmed_stopped",
        owner_manual_writes: "confirmed_stopped",
      },
      adminSdkCredentialReview: "confirmed",
      firebaseCliSessionReview: "confirmed",
      groupMembershipReview: "confirmed",
      inheritedIamReview: "confirmed",
      auditLogObservationWindow: "confirmed",
      snapshotKeyRecoveryDrill: "confirmed",
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
    productionExecuteGatesClosed: true,
    expectedRulesBaseline: RULES_BASELINE,
    now: NOW,
  };
}

function readinessArgs(): CutoverReadinessArguments {
  return {
    command: "readiness",
    projectId: CUTOVER_INFRA_CONTRACT.projectId,
    expectedOperatorPrincipal: "user:operator@example.com",
    rulesDeployPrincipal: "user:rules-deployer@example.com",
    bindingExpiresAt: "2026-07-17T12:00:00Z",
    keyId: "transition-v1",
    snapshotDirectory: "/private/tmp/cutover",
    dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
    rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
    expectedMainCommit: MAIN,
    databaseId: "(default)",
    expectedDatabaseUid: "database-uid",
  };
}

function exactInfraReport(): CutoverInfraPlanReport {
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
      dataWriteAuditLogs: "exact",
      snapshotKeychainEntry: "present",
      snapshotDirectory: "local_apfs_non_synced",
    },
    actions: [],
    applyBlockers: [],
    readinessBlockers: [],
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
