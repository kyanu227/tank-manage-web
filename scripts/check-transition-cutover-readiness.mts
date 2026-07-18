import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assessCutoverReadiness,
  formatCutoverReadinessReport,
  isExpectedCutoverOriginRemote,
  loadReadinessEvidenceFiles,
  productionExecuteGatePosture,
} from "./cutover/cutover-readiness-service";
import { planCutoverInfrastructure } from "./cutover/cutover-infra-service";
import { GcloudInfraError } from "./cutover/gcloud-infra-adapter";
import {
  parseCutoverHumanEvidence,
  parseCutoverReadinessArguments,
} from "./cutover/infra-contract";
import { parseFirestoreRulesBaselineManifest } from "./cutover/firestore-rules-baseline";
import type {
  DataReadinessEvidenceV1,
  RulesReadinessEvidenceV2,
} from "./cutover/readiness-evidence";
import { reportCutoverCliError } from "./cutover/snapshot-cli-common";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const now = new Date();
  const args = parseCutoverReadinessArguments(process.argv.slice(2), { now });
  const repositoryRoot = gitRoot();
  const initialRepositoryBlocker = repositoryContextBlocker(
    repositoryRoot,
    args.expectedMainCommit,
  );

  let infra: Awaited<ReturnType<typeof planCutoverInfrastructure>> | null = null;
  let infraFailureCode: string | undefined;
  try {
    infra = await planCutoverInfrastructure({ args, repositoryRoot });
  } catch (error) {
    infraFailureCode = safeInfraFailureCode(error);
  }

  let human = parseCutoverHumanEvidence(undefined);
  let rules: RulesReadinessEvidenceV2 | null = null;
  let data: DataReadinessEvidenceV1 | null = null;
  let evidenceFileBlocker: string | undefined;
  try {
    ({ human, rules, data } = await loadReadinessEvidenceFiles({ args, repositoryRoot }));
  } catch {
    evidenceFileBlocker = "READINESS_EVIDENCE_FILE_INVALID";
  }

  const manifest = parseFirestoreRulesBaselineManifest(JSON.parse(await readFile(
    join(repositoryRoot, "firestore.cutover-baseline.manifest.json"),
    "utf8",
  )));
  const report = assessCutoverReadiness({
    args,
    infra,
    infraFailureCode,
    human,
    rules,
    data,
    productionExecuteGatePosture: await productionExecuteGatePosture(repositoryRoot),
    expectedRulesBaseline: manifest,
    now,
  });
  const finalRepositoryBlocker = repositoryContextBlocker(
    repositoryRoot,
    args.expectedMainCommit,
  );
  [initialRepositoryBlocker, finalRepositoryBlocker].forEach((blocker) => {
    if (blocker) report.blocking.push(blocker);
  });
  if (evidenceFileBlocker) report.blocking.push(evidenceFileBlocker);
  report.blocking = [...new Set(report.blocking)].sort();
  report.status = report.blocking.length === 0 ? "GO" : "NO-GO";
  console.log(formatCutoverReadinessReport(report));
  process.exitCode = report.status === "GO" ? 0 : 2;
}

function safeInfraFailureCode(error: unknown): string {
  if (error instanceof GcloudInfraError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^GCLOUD_[A-Z_]+$/u.test(code)) return code;
  }
  return "INFRA_PLAN_UNAVAILABLE";
}

function gitRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repositoryContextBlocker(repositoryRoot: string, expectedMainCommit: string): string | null {
  try {
    const output = (args: string[]) => execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
    if (!isExpectedCutoverOriginRemote(output(["remote", "get-url", "origin"]))) {
      return "ORIGIN_REPOSITORY_MISMATCH";
    }
    if (output(["rev-parse", "HEAD"]) !== expectedMainCommit) return "HEAD_NOT_EXPECTED_MAIN";
    if (output(["rev-parse", "origin/main"]) !== expectedMainCommit) return "ORIGIN_MAIN_MISMATCH";
    if (
      output(["ls-remote", "--exit-code", "origin", "refs/heads/main"])
      !== `${expectedMainCommit}\trefs/heads/main`
    ) return "REMOTE_MAIN_MISMATCH";
    if (output(["status", "--porcelain"])) return "WORKTREE_NOT_CLEAN";
    return null;
  } catch {
    return "GIT_CONTEXT_UNAVAILABLE";
  }
}
