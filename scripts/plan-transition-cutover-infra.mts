import { execFileSync } from "node:child_process";
import { planCutoverInfrastructure } from "./cutover/cutover-infra-service";
import { parseCutoverInfraPlanArguments } from "./cutover/infra-contract";
import { reportCutoverCliError } from "./cutover/snapshot-cli-common";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = parseCutoverInfraPlanArguments(process.argv.slice(2));
  const repositoryRoot = gitRoot();
  const report = await planCutoverInfrastructure({ args, repositoryRoot });
  console.log(JSON.stringify(report, null, 2));
}

function gitRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
