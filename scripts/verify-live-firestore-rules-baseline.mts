import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseFirestoreRulesBaselineManifest,
} from "./cutover/firestore-rules-baseline";
import { parseRulesBaselineCommandArguments } from "./cutover/rules-baseline-command";
import { runRulesBaselineRuntime } from "./cutover/rules-baseline-runtime";
import {
  assertProductionCredentialHygiene,
  reportCutoverCliError,
} from "./cutover/snapshot-cli-common";
import { createRulesReadinessEvidence } from "./cutover/readiness-evidence";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

/** freeze deploy前だけに使う。freeze後のdeny-all Rulesを検査するcommandではない。 */
async function main(): Promise<void> {
  const args = parseRulesBaselineCommandArguments(process.argv.slice(2));
  if (process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
    throw new Error("live Rules baseline検証ではFirestore Emulator環境変数を使用できません");
  }
  const repositoryRoot = gitOutput(["rev-parse", "--show-toplevel"]);
  assertProductionCredentialHygiene({
    repositoryRoot,
    credentialPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
  assertMainRepositoryContext(repositoryRoot, args.expectedMainCommit);

  const manifest = parseFirestoreRulesBaselineManifest(JSON.parse(await readFile(
    join(repositoryRoot, "firestore.cutover-baseline.manifest.json"),
    "utf8",
  )));
  if (manifest.projectId !== args.projectId) {
    throw new Error("明示projectがRules baseline manifestと一致しません");
  }
  const baselineSource = await readFile(
    join(repositoryRoot, "firestore.cutover-baseline.rules"),
    "utf8",
  );
  const gitSource = execFileSync(
    "git",
    ["show", `${manifest.gitCommit}:${manifest.pinnedGitRulesFile}`],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const result = await runRulesBaselineRuntime({
    projectId: args.projectId,
    expectedDataPrincipal: args.expectedDataPrincipal,
    expectedRulesPrincipal: args.expectedRulesPrincipal,
    manifest,
    baselineSource,
    gitSource,
  });

  // 既存commandのstdout契約は維持し、明示flag時だけreadiness証跡へ封入する。
  if (!args.readinessEvidence) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  // Rules本文、token、credential path、principal本文はstdoutへ出さない。
  console.log(JSON.stringify(createRulesReadinessEvidence({
    generatedAt: new Date().toISOString(),
    projectId: args.projectId,
    mainCommit: args.expectedMainCommit,
    principal: args.expectedRulesPrincipal,
    payload: {
      matched: result.matched,
      releaseId: result.releaseId,
      releaseCreateTime: result.releaseCreateTime,
      releaseUpdateTime: result.releaseUpdateTime,
      rulesetId: result.rulesetId,
      rulesetCreateTime: result.rulesetCreateTime,
      liveRulesSourceFile: result.liveRulesSourceFile,
      normalizedSha256: result.normalizedSha256,
      normalizedBytes: result.normalizedBytes,
    },
  }), null, 2));
}

function assertMainRepositoryContext(repositoryRoot: string, expectedMainCommit: string): void {
  const head = gitOutput(["rev-parse", "HEAD"], repositoryRoot);
  if (head !== expectedMainCommit) {
    throw new Error("現在のHEADとexpected main commitが一致しません");
  }
  if (gitOutput(["status", "--porcelain"], repositoryRoot)) {
    throw new Error("live Rules baseline検証はclean worktreeでだけ実行できます");
  }
  const originMain = gitOutput(["rev-parse", "origin/main"], repositoryRoot);
  if (originMain !== expectedMainCommit) {
    throw new Error("origin/mainとexpected main commitが一致しません");
  }
  const remoteMain = gitOutput(
    ["ls-remote", "--exit-code", "origin", "refs/heads/main"],
    repositoryRoot,
  );
  if (remoteMain !== `${expectedMainCommit}\trefs/heads/main`) {
    throw new Error("remote mainとexpected main commitが一致しません");
  }
}

function gitOutput(args: string[], cwd = process.cwd()): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  }).trim();
}
