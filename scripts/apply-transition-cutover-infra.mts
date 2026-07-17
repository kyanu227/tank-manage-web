import { execFileSync } from "node:child_process";
import { applyCutoverInfrastructure } from "./cutover/cutover-infra-service";
import { parseCutoverInfraApplyArguments } from "./cutover/infra-contract";
import { reportCutoverCliError } from "./cutover/snapshot-cli-common";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  // confirmationはgit・gcloud・Keychain accessより先に検証する。
  const args = parseCutoverInfraApplyArguments(process.argv.slice(2));
  const repositoryRoot = gitRoot();
  const report = await applyCutoverInfrastructure({ args, repositoryRoot });
  console.log(JSON.stringify({ ...report, mode: "infra-apply-verified" }, null, 2));
}

function gitRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
