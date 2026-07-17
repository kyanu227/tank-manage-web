import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
  RULES_READER_REQUIRED_IAM_PERMISSIONS,
} from "./migration-credential";
import {
  CUTOVER_INFRA_CONFIRMATION,
  CUTOVER_INFRA_CONTRACT,
  CUTOVER_PROJECT_ID,
  REQUIRED_HUMAN_CONFIRMATION_IDS,
  assertCutoverInfraApplyAuthorization,
  assertCutoverInfraCommonContract,
  assertCutoverInfraPrincipalSeparation,
  parseCutoverHumanEvidence,
  parseCutoverInfraApplyArguments,
  parseCutoverInfraPlanArguments,
  parseCutoverReadinessArguments,
  requireTemporaryBindingExpiration,
} from "./infra-contract";

const NOW = new Date("2026-07-17T00:00:00.000Z");
const OPERATOR = "user:cutover-operator@example.com";
const RULES_DEPLOY = "user:rules-deployer@example.com";

describe("cutover infra fixed contract", () => {
  it("pinned baseline manifestと同じproduction projectだけを使う", () => {
    const manifest = JSON.parse(readFileSync(
      new URL("../../firestore.cutover-baseline.manifest.json", import.meta.url),
      "utf8",
    )) as { projectId: string };
    expect(CUTOVER_PROJECT_ID).toBe("okmarine-tankrental");
    expect(CUTOVER_PROJECT_ID).toBe(manifest.projectId);
  });

  it("固定SA・role IDと既存の7+2 permission契約を再利用する", () => {
    expect(CUTOVER_INFRA_CONTRACT.serviceAccounts).toEqual({
      data: {
        id: "transition-cutover-data",
        email: "transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com",
      },
      rules: {
        id: "transition-rules-reader",
        email: "transition-rules-reader@okmarine-tankrental.iam.gserviceaccount.com",
      },
    });
    expect(CUTOVER_INFRA_CONTRACT.roles.data.id).toBe("transitionCutoverData");
    expect(CUTOVER_INFRA_CONTRACT.roles.rules.id).toBe("transitionRulesBaselineRead");
    expect(CUTOVER_INFRA_CONTRACT.roles.data.permissions)
      .toBe(DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS);
    expect(CUTOVER_INFRA_CONTRACT.roles.rules.permissions)
      .toBe(RULES_READER_REQUIRED_IAM_PERMISSIONS);
    expect(CUTOVER_INFRA_CONTRACT.roles.data.permissions).toHaveLength(7);
    expect(CUTOVER_INFRA_CONTRACT.roles.rules.permissions).toHaveLength(2);
  });
});

describe("cutover infra principal boundary", () => {
  it("data・Rules reader・Rules deployを分離する", () => {
    expect(assertCutoverInfraPrincipalSeparation({
      dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
      rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
      rulesDeployPrincipal: RULES_DEPLOY,
    })).toEqual({
      dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
      rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
      rulesDeployPrincipal: RULES_DEPLOY,
    });
  });

  it.each([
    `serviceAccount:${CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email}`,
    `serviceAccount:${CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email}`,
  ])("Rules deploy principalの再利用を拒否する: %s", (rulesDeployPrincipal) => {
    expect(() => assertCutoverInfraPrincipalSeparation({
      dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
      rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
      rulesDeployPrincipal,
    })).toThrow("Rules deploy principal");
  });

  it("dataとRules readerが同一なら拒否する", () => {
    expect(() => assertCutoverInfraPrincipalSeparation({
      dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
      rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
      rulesDeployPrincipal: RULES_DEPLOY,
    })).toThrow("principalは分離");
  });
});

describe("temporary IAM binding expiration", () => {
  it.each([
    "2026-07-17T00:00:01Z",
    "2026-07-18T00:00:00Z",
    "2026-07-17T12:34:56.123Z",
  ])("未来かつ24時間以内のRFC3339 UTCを受理する: %s", (value) => {
    expect(requireTemporaryBindingExpiration(value, NOW)).toBe(value);
  });

  it.each([
    "2026-07-17T00:00:00Z",
    "2026-07-16T23:59:59Z",
  ])("現在以前の期限を拒否する: %s", (value) => {
    expect(() => requireTemporaryBindingExpiration(value, NOW)).toThrow("未来");
  });

  it("24時間を1msでも超える期限を拒否する", () => {
    expect(() => requireTemporaryBindingExpiration(
      "2026-07-18T00:00:00.001Z",
      NOW,
    )).toThrow("24時間以内");
  });

  it.each([
    "2026-07-17T12:00:00+09:00",
    "2026-02-30T12:00:00Z",
    "2026-07-17 12:00:00Z",
    "2026-07-17T12:34:56.123456789Z",
    "not-a-date",
  ])("不正またはUTCでないtimestampを拒否する: %s", (value) => {
    expect(() => requireTemporaryBindingExpiration(value, NOW)).toThrow();
  });
});

describe("strict CLI argument parser", () => {
  it("plan引数を固定contractへ正規化する", () => {
    const result = parseCutoverInfraPlanArguments(commonArguments(), { now: NOW });
    expect(result).toMatchObject({
      command: "plan",
      projectId: CUTOVER_PROJECT_ID,
      expectedOperatorPrincipal: OPERATOR,
      rulesDeployPrincipal: RULES_DEPLOY,
      bindingExpiresAt: "2026-07-17T12:00:00Z",
      keyId: "transition-v1",
      snapshotDirectory: "/private/var/tmp/tank-cutover",
      snapshotStorageMode: "local_encrypted",
      dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
      rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
    });
  });

  it("applyはnetwork accessなしにexecuteと完全一致confirmを要求する", () => {
    const result = parseCutoverInfraApplyArguments([
      ...commonArguments(),
      "--execute",
      `--confirm=${CUTOVER_INFRA_CONFIRMATION}`,
    ], { now: NOW });
    expect(result.execute).toBe(true);
    expect(result.confirmation).toBe(CUTOVER_INFRA_CONFIRMATION);
  });

  it("applyのexecuteまたはconfirm不足・不一致を拒否する", () => {
    expect(() => parseCutoverInfraApplyArguments([
      ...commonArguments(),
      `--confirm=${CUTOVER_INFRA_CONFIRMATION}`,
    ], { now: NOW })).toThrow("--execute");
    expect(() => parseCutoverInfraApplyArguments([
      ...commonArguments(),
      "--execute",
    ], { now: NOW })).toThrow("--confirm");
    expect(() => parseCutoverInfraApplyArguments([
      ...commonArguments(),
      "--execute",
      "--confirm=WRONG",
    ], { now: NOW })).toThrow("--confirm");
  });

  it("service用runtime contractも固定project・identity・期限・confirmationを再検証する", () => {
    const valid = parseCutoverInfraApplyArguments([
      ...commonArguments(),
      "--execute",
      `--confirm=${CUTOVER_INFRA_CONFIRMATION}`,
    ], { now: NOW });
    expect(() => assertCutoverInfraCommonContract(valid, { now: NOW })).not.toThrow();
    expect(() => assertCutoverInfraApplyAuthorization(valid, { now: NOW })).not.toThrow();
    expect(() => assertCutoverInfraApplyAuthorization({
      ...valid,
      projectId: "other-project",
    }, { now: NOW })).toThrow("fixed contract");
    expect(() => assertCutoverInfraApplyAuthorization({
      ...valid,
      bindingExpiresAt: "2026-07-16T00:00:00Z",
    }, { now: NOW })).toThrow("未来");
    expect(() => assertCutoverInfraApplyAuthorization({
      ...valid,
      confirmation: "WRONG",
    }, { now: NOW })).toThrow("authorization");
  });

  it("operatorにtarget service account自身を指定できない", () => {
    expect(() => parseCutoverInfraPlanArguments(
      replaceArgument(
        commonArguments(),
        "--expected-operator-principal",
        `serviceAccount:${CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email}`,
      ),
      { now: NOW },
    )).toThrow("operator principal");
  });

  it("operatorにはservice accountではなく人間のuser principalを要求する", () => {
    expect(() => parseCutoverInfraPlanArguments(
      replaceArgument(
        commonArguments(),
        "--expected-operator-principal",
        "serviceAccount:cutover-operator@okmarine-tankrental.iam.gserviceaccount.com",
      ),
      { now: NOW },
    )).toThrow("人間");
  });

  it("readinessはmain・database・任意の証跡pathを厳格に解析する", () => {
    const result = parseCutoverReadinessArguments([
      ...commonArguments(),
      `--expected-main-commit=${"a".repeat(40)}`,
      "--database=(default)",
      "--expected-database-uid=database-uid",
      "--human-evidence=/private/var/tmp/human.json",
      "--rules-baseline-evidence=/private/var/tmp/rules.json",
      "--data-preflight-evidence=/private/var/tmp/data.json",
    ], { now: NOW });
    expect(result).toMatchObject({
      command: "readiness",
      expectedMainCommit: "a".repeat(40),
      databaseId: "(default)",
      expectedDatabaseUid: "database-uid",
      humanEvidencePath: "/private/var/tmp/human.json",
      rulesBaselineEvidencePath: "/private/var/tmp/rules.json",
      dataPreflightEvidencePath: "/private/var/tmp/data.json",
    });
  });

  it("readinessの証跡pathは省略でき、後段でunknownとして扱える", () => {
    const result = parseCutoverReadinessArguments([
      ...commonArguments(),
      `--expected-main-commit=${"b".repeat(40)}`,
      "--database=(default)",
      "--expected-database-uid=database-uid",
    ], { now: NOW });
    expect(result.humanEvidencePath).toBeUndefined();
    expect(result.rulesBaselineEvidencePath).toBeUndefined();
    expect(result.dataPreflightEvidencePath).toBeUndefined();
  });

  it("wrong project・未知引数・重複・相対path・不正principalを拒否する", () => {
    expect(() => parseCutoverInfraPlanArguments(
      replaceArgument(commonArguments(), "--project", "other-project"),
      { now: NOW },
    )).toThrow("固定");
    expect(() => parseCutoverInfraPlanArguments([
      ...commonArguments(),
      "--unexpected=value",
    ], { now: NOW })).toThrow("未知");
    expect(() => parseCutoverInfraPlanArguments([
      ...commonArguments(),
      `--project=${CUTOVER_PROJECT_ID}`,
    ], { now: NOW })).toThrow("重複");
    expect(() => parseCutoverInfraPlanArguments(
      replaceArgument(commonArguments(), "--snapshot-directory", "relative/path"),
      { now: NOW },
    )).toThrow("絶対path");
    expect(() => parseCutoverInfraPlanArguments(
      replaceArgument(commonArguments(), "--expected-operator-principal", "operator@example.com"),
      { now: NOW },
    )).toThrow("IAM principal");
    expect(() => parseCutoverInfraPlanArguments(
      replaceArgument(commonArguments(), "--snapshot-storage-mode", "plaintext"),
      { now: NOW },
    )).toThrow("storage mode");
    expect(() => parseCutoverInfraPlanArguments(
      commonArguments().filter((argument) => !argument.startsWith("--snapshot-storage-mode=")),
      { now: NOW },
    )).toThrow("--snapshot-storage-mode");
  });

  it("planとreadinessはapply専用flagを拒否する", () => {
    expect(() => parseCutoverInfraPlanArguments([
      ...commonArguments(),
      "--execute",
    ], { now: NOW })).toThrow("未知");
    expect(() => parseCutoverReadinessArguments([
      ...commonArguments(),
      `--expected-main-commit=${"c".repeat(40)}`,
      "--database=(default)",
      "--expected-database-uid=uid",
      "--execute",
    ], { now: NOW })).toThrow("未知");
  });
});

describe("human evidence schema", () => {
  it("未回答をすべてnullへ正規化する", () => {
    const evidence = parseCutoverHumanEvidence(undefined);
    expect(evidence.version).toBe(1);
    expect(evidence.projectId).toBeNull();
    expect(evidence.mainCommit).toBeNull();
    expect(evidence.keyId).toBeNull();
    expect(evidence.expectedOperatorPrincipal).toBeNull();
    expect(evidence.rulesDeployPrincipal).toBeNull();
    expect(evidence.reviewedAt).toBeNull();
    expect(evidence.confirmedByPrincipal).toBeNull();
    expect(evidence.externalWritersConfirmedAbsent).toBeNull();
    expect(evidence.otherPcAutomationConfirmedAbsent).toBeNull();
    expect(evidence.maintenanceWindowApproved).toBeNull();
    expect(evidence.productionUsageStarted).toBeNull();
    expect(evidence.encryptedICloudSnapshotApproved).toBeNull();
  });

  it("部分回答だけを保存し、未回答項目はnullのままにする", () => {
    const evidence = parseCutoverHumanEvidence({
      version: 1,
      projectId: CUTOVER_PROJECT_ID,
      mainCommit: "a".repeat(40),
      keyId: "transition-v1",
      expectedOperatorPrincipal: OPERATOR,
      rulesDeployPrincipal: RULES_DEPLOY,
      reviewedAt: "2026-07-17T00:00:00.000Z",
      confirmedByPrincipal: OPERATOR,
      externalWritersConfirmedAbsent: true,
      maintenanceWindowApproved: true,
      productionUsageStarted: false,
    });
    expect(evidence.externalWritersConfirmedAbsent).toBe(true);
    expect(evidence.otherPcAutomationConfirmedAbsent).toBeNull();
    expect(evidence.maintenanceWindowApproved).toBe(true);
    expect(evidence.productionUsageStarted).toBe(false);
    expect(evidence.encryptedICloudSnapshotApproved).toBeNull();
    expect(evidence.keyId).toBe("transition-v1");
    expect(evidence.expectedOperatorPrincipal).toBe(OPERATOR);
    expect(evidence.rulesDeployPrincipal).toBe(RULES_DEPLOY);
    expect(evidence.confirmedByPrincipal).toBe(OPERATOR);
  });

  it("未知fieldや不正booleanをfail closedにする", () => {
    expect(() => parseCutoverHumanEvidence({ version: 1, unexpected: true })).toThrow("未知");
    expect(() => parseCutoverHumanEvidence({
      version: 1,
      externalWritersConfirmedAbsent: false,
    })).toThrow("trueまたはnull");
    expect(() => parseCutoverHumanEvidence({
      version: 1,
      productionUsageStarted: "no",
    })).toThrow("booleanまたはnull");
    expect(() => parseCutoverHumanEvidence({ version: 1, keyId: "bad key" }))
      .toThrow("keyId");
    expect(() => parseCutoverHumanEvidence({
      version: 1,
      expectedOperatorPrincipal: "serviceAccount:operator@okmarine-tankrental.iam.gserviceaccount.com",
    })).toThrow("人間");
  });

  it("confirmation契約が簡略化した5項目だけを網羅する", () => {
    expect(REQUIRED_HUMAN_CONFIRMATION_IDS).toEqual([
      "externalWritersConfirmedAbsent",
      "otherPcAutomationConfirmedAbsent",
      "maintenanceWindowApproved",
      "productionUsageStarted",
      "encryptedICloudSnapshotApproved",
    ]);
  });
});

function commonArguments(): string[] {
  return [
    `--project=${CUTOVER_PROJECT_ID}`,
    `--expected-operator-principal=${OPERATOR}`,
    `--rules-deploy-principal=${RULES_DEPLOY}`,
    "--binding-expires-at=2026-07-17T12:00:00Z",
    "--key-id=transition-v1",
    "--snapshot-directory=/private/var/tmp/tank-cutover",
    "--snapshot-storage-mode=local_encrypted",
  ];
}

function replaceArgument(argv: string[], name: string, value: string): string[] {
  return argv.map((argument) => argument.startsWith(`${name}=`) ? `${name}=${value}` : argument);
}
