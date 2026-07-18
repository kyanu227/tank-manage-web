import { describe, expect, it, vi } from "vitest";
import type { FirestoreRulesBaselineManifest } from "./firestore-rules-baseline";
import { RULES_READER_REQUIRED_IAM_PERMISSIONS } from "./migration-credential";
import { runRulesBaselineRuntime } from "./rules-baseline-runtime";

const PROJECT_ID = "example-project";
const DATA_PRINCIPAL = "cutover-data@example-project.iam.gserviceaccount.com";
const RULES_PRINCIPAL = "cutover-rules@example-project.iam.gserviceaccount.com";

describe("Rules baseline runtime credential boundary", () => {
  it("Rules readerの2権限だけを確認し、そのproviderだけをRules検証へ渡す", async () => {
    const rulesTokenProvider = vi.fn(async () => "rules-token");
    const verifyRulesCredential = vi.fn(async () => ({
      kind: "rules_reader" as const,
      principal: RULES_PRINCIPAL,
      projectId: PROJECT_ID,
      permissions: RULES_READER_REQUIRED_IAM_PERMISSIONS,
      accessTokenProvider: rulesTokenProvider,
    }));
    const verifyLiveBaseline = vi.fn(async (input) => {
      expect(input.rulesReaderCredential.kind).toBe("rules_reader");
      expect(input.rulesReaderCredential.accessTokenProvider).toBe(rulesTokenProvider);
      return verifiedBaseline();
    });

    const result = await runRulesBaselineRuntime(runtimeInput(), {
      verifyRulesCredential,
      verifyLiveBaseline,
    });

    expect(verifyRulesCredential).toHaveBeenCalledWith({
      expectedRulesPrincipal: RULES_PRINCIPAL,
      expectedProjectId: PROJECT_ID,
    });
    expect(result.credential).toEqual({
      kind: "rules_reader",
      expectedRulesPrincipalConfirmed: true,
      distinctFromDataPrincipalConfirmed: true,
      requiredPermissionsConfirmed: true,
      requiredPermissionCount: 2,
    });
    expect(rulesTokenProvider).not.toHaveBeenCalled();
  });

  it("同一data／Rules principalをcredential取得前に拒否する", async () => {
    const verifyRulesCredential = vi.fn();
    const verifyLiveBaseline = vi.fn();
    await expect(runRulesBaselineRuntime({
      ...runtimeInput(),
      expectedRulesPrincipal: DATA_PRINCIPAL,
    }, {
      verifyRulesCredential,
      verifyLiveBaseline,
    })).rejects.toThrow("分離");
    expect(verifyRulesCredential).not.toHaveBeenCalled();
    expect(verifyLiveBaseline).not.toHaveBeenCalled();
  });
});

function runtimeInput() {
  return {
    projectId: PROJECT_ID,
    expectedDataPrincipal: DATA_PRINCIPAL,
    expectedRulesPrincipal: RULES_PRINCIPAL,
    manifest: manifest(),
    baselineSource: "rules_version = '2';\n",
    gitSource: "rules_version = '2';\n",
  };
}

function manifest(): FirestoreRulesBaselineManifest {
  return {
    version: 2,
    projectId: PROJECT_ID,
    releaseName: `projects/${PROJECT_ID}/releases/cloud.firestore`,
    releaseCreateTime: "2026-01-01T00:00:00Z",
    releaseUpdateTime: "2026-01-01T00:00:01Z",
    rulesetName: `projects/${PROJECT_ID}/rulesets/ruleset-id`,
    rulesetCreateTime: "2026-01-01T00:00:00Z",
    pinnedGitRulesFile: "firestore.rules",
    liveRulesSourceFile: "firestore.cutover-baseline.rules",
    gitCommit: "a".repeat(40),
    normalizedSha256: "b".repeat(64),
    normalizedBytes: 21,
  };
}

function verifiedBaseline() {
  return {
    mode: "pre-freeze-live-rules-baseline-verification" as const,
    matched: true as const,
    projectId: PROJECT_ID,
    releaseId: "cloud.firestore" as const,
    releaseCreateTime: "2026-01-01T00:00:00Z",
    releaseUpdateTime: "2026-01-01T00:00:01Z",
    rulesetId: "ruleset-id",
    rulesetCreateTime: "2026-01-01T00:00:00Z",
    liveRulesSourceFile: "firestore.cutover-baseline.rules",
    gitCommit: "a".repeat(40),
    normalizedSha256: "b".repeat(64),
    normalizedBytes: 21,
  };
}
