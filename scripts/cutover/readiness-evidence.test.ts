import { describe, expect, it } from "vitest";
import {
  assertFreshReadinessEvidence,
  createDataReadinessEvidence,
  createRulesReadinessEvidence,
  parseCutoverReadinessEvidence,
} from "./readiness-evidence";

const PROJECT_ID = "okmarine-tankrental";
const MAIN_COMMIT = "a".repeat(40);
const RULES_PRINCIPAL = "rules@okmarine-tankrental.iam.gserviceaccount.com";
const DATA_PRINCIPAL = "data@okmarine-tankrental.iam.gserviceaccount.com";

describe("cutover readiness evidence", () => {
  it("Rules証跡をcanonical hashへ固定し、改ざんを拒否する", () => {
    const evidence = rulesEvidence();
    expect(evidence.version).toBe(2);
    expect(parseCutoverReadinessEvidence(evidence)).toEqual(evidence);
    expect(() => parseCutoverReadinessEvidence({
      ...evidence,
      payload: { ...evidence.payload, normalizedBytes: evidence.payload.normalizedBytes + 1 },
    })).toThrow("hash");
  });

  it("旧version 1のRules証跡をfail closedで拒否する", () => {
    const evidence = rulesEvidence();
    expect(() => parseCutoverReadinessEvidence({
      ...evidence,
      version: 1,
    })).toThrow("version");
  });

  it("data証跡をprincipal・project・main・freshnessへ結び付ける", () => {
    const evidence = dataEvidence();
    expect(() => assertFreshReadinessEvidence({
      evidence,
      expectedProjectId: PROJECT_ID,
      expectedMainCommit: MAIN_COMMIT,
      expectedPrincipal: DATA_PRINCIPAL,
      now: new Date("2026-07-17T00:10:00.000Z"),
    })).not.toThrow();
    expect(() => assertFreshReadinessEvidence({
      evidence,
      expectedProjectId: PROJECT_ID,
      expectedMainCommit: MAIN_COMMIT,
      expectedPrincipal: RULES_PRINCIPAL,
      now: new Date("2026-07-17T00:10:00.000Z"),
    })).toThrow("principal");
  });

  it("未来または期限切れの証跡を拒否する", () => {
    const evidence = rulesEvidence();
    expect(() => assertFreshReadinessEvidence({
      evidence,
      expectedProjectId: PROJECT_ID,
      expectedMainCommit: MAIN_COMMIT,
      expectedPrincipal: RULES_PRINCIPAL,
      now: new Date("2026-07-17T00:20:00.000Z"),
    })).toThrow("期限外");
    expect(() => assertFreshReadinessEvidence({
      evidence,
      expectedProjectId: PROJECT_ID,
      expectedMainCommit: MAIN_COMMIT,
      expectedPrincipal: RULES_PRINCIPAL,
      now: new Date("2026-07-16T23:59:59.000Z"),
    })).toThrow("期限外");
  });

  it("status集計がtank件数と一致しないdata証跡を拒否する", () => {
    expect(() => createDataReadinessEvidence({
      generatedAt: "2026-07-17T00:00:00.000Z",
      projectId: PROJECT_ID,
      databaseId: "(default)",
      databaseUid: "database-uid",
      mainCommit: MAIN_COMMIT,
      principal: DATA_PRINCIPAL,
      payload: {
        counts: { tanks: 2, tankLogs: 0, transactions: 0 },
        statusCounts: { empty: 1 },
        writes: 3,
        requestBytes: 100,
        sourceCensusSha256: "c".repeat(64),
        documentPathSha256: "d".repeat(64),
      },
    })).toThrow("tank件数");
  });
});

function rulesEvidence() {
  return createRulesReadinessEvidence({
    generatedAt: "2026-07-17T00:00:00.000Z",
    projectId: PROJECT_ID,
    mainCommit: MAIN_COMMIT,
    principal: RULES_PRINCIPAL,
    payload: {
      matched: true,
      releaseId: "cloud.firestore",
      releaseCreateTime: "2026-03-11T07:36:20.560827Z",
      releaseUpdateTime: "2026-06-02T08:28:53.917518Z",
      rulesetId: "ruleset-id",
      rulesetCreateTime: "2026-06-02T08:28:52.433311Z",
      liveRulesSourceFile: "firestore.cutover-baseline.rules",
      normalizedSha256: "b".repeat(64),
      normalizedBytes: 100,
    },
  });
}

function dataEvidence() {
  return createDataReadinessEvidence({
    generatedAt: "2026-07-17T00:00:00.000Z",
    projectId: PROJECT_ID,
    databaseId: "(default)",
    databaseUid: "database-uid",
    mainCommit: MAIN_COMMIT,
    principal: DATA_PRINCIPAL,
    payload: {
      counts: { tanks: 145, tankLogs: 38, transactions: 8 },
      statusCounts: { empty: 20, lent: 125 },
      writes: 192,
      requestBytes: 80_200,
      sourceCensusSha256: "c".repeat(64),
      documentPathSha256: "d".repeat(64),
    },
  });
}
