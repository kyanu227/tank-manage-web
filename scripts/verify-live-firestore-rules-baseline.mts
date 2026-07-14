import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseFirestoreRulesBaselineManifest,
  verifyLiveFirestoreRulesBaseline,
} from "./cutover/firestore-rules-baseline";
import { verifyMigrationCredential } from "./cutover/migration-credential";
import {
  argumentValue,
  assertProductionCredentialHygiene,
  reportCutoverCliError,
} from "./cutover/snapshot-cli-common";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

/** freeze deploy前だけに使う。freeze後のdeny-all Rulesを検査するcommandではない。 */
async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
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
    ["show", `${manifest.gitCommit}:${manifest.rulesFile}`],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const credential = await verifyMigrationCredential({
    expectedPrincipal: args.expectedPrincipal,
    expectedProjectId: args.projectId,
  });
  const result = await verifyLiveFirestoreRulesBaseline({
    projectId: args.projectId,
    accessTokenProvider: credential.accessTokenProvider,
    manifest,
    baselineSource,
    gitSource,
  });

  // Rules本文、token、credential pathはstdoutへ出さない。
  console.log(JSON.stringify({
    ...result,
    credential: {
      expectedPrincipalConfirmed: true,
      requiredPermissionsConfirmed: true,
      requiredPermissionCount: credential.permissions.length,
    },
  }, null, 2));
}

function parseArguments(argv: readonly string[]): {
  projectId: string;
  expectedMainCommit: string;
  expectedPrincipal: string;
} {
  const knownNames = new Set([
    "--project",
    "--expected-main-commit",
    "--expected-principal",
  ]);
  const seen = new Set<string>();
  argv.forEach((argument) => {
    const name = argument.split("=", 1)[0];
    if (!knownNames.has(name) || !argument.startsWith(`${name}=`)) {
      throw new Error("live Rules baseline検証に未知の引数があります");
    }
    if (seen.has(name)) throw new Error("live Rules baseline検証の引数を重複指定できません");
    seen.add(name);
  });
  const projectId = argumentValue(argv, "--project");
  const expectedMainCommit = argumentValue(argv, "--expected-main-commit");
  const expectedPrincipal = argumentValue(argv, "--expected-principal");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    throw new Error("--project=<explicit-project-id>が不正です");
  }
  if (!/^[0-9a-f]{40}$/u.test(expectedMainCommit)) {
    throw new Error("--expected-main-commitには40文字のGit SHAが必要です");
  }
  if (!expectedPrincipal) {
    throw new Error("--expected-principal=<service-account-email>は必須です");
  }
  return { projectId, expectedMainCommit, expectedPrincipal };
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
