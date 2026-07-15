import { assertDistinctCutoverPrincipals } from "./migration-credential";
import { argumentValue } from "./snapshot-cli-common";

export type RulesBaselineCommandArguments = {
  projectId: string;
  expectedMainCommit: string;
  expectedDataPrincipal: string;
  expectedRulesPrincipal: string;
};

/** 認証やnetwork accessより先に、live Rules検証用の引数境界を確定する。 */
export function parseRulesBaselineCommandArguments(
  argv: readonly string[],
): RulesBaselineCommandArguments {
  const knownNames = new Set([
    "--project",
    "--expected-main-commit",
    "--expected-data-principal",
    "--expected-rules-principal",
  ]);
  const seen = new Set<string>();
  argv.forEach((argument) => {
    const name = argument.split("=", 1)[0];
    if (!knownNames.has(name) || !argument.startsWith(`${name}=`)) {
      throw new Error("live Rules baseline検証に未知の引数があります");
    }
    if (seen.has(name)) {
      throw new Error("live Rules baseline検証の引数を重複指定できません");
    }
    seen.add(name);
  });

  const projectId = argumentValue(argv, "--project");
  const expectedMainCommit = argumentValue(argv, "--expected-main-commit");
  const expectedDataPrincipal = argumentValue(argv, "--expected-data-principal");
  const expectedRulesPrincipal = argumentValue(argv, "--expected-rules-principal");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    throw new Error("--project=<explicit-project-id>が不正です");
  }
  if (!/^[0-9a-f]{40}$/u.test(expectedMainCommit)) {
    throw new Error("--expected-main-commitには40文字のGit SHAが必要です");
  }
  if (!expectedDataPrincipal) {
    throw new Error("--expected-data-principal=<data-migration-service-account>は必須です");
  }
  if (!expectedRulesPrincipal) {
    throw new Error("--expected-rules-principal=<rules-reader-service-account>は必須です");
  }
  const principals = assertDistinctCutoverPrincipals({
    expectedDataPrincipal,
    expectedRulesPrincipal,
  });
  return { projectId, expectedMainCommit, ...principals };
}
