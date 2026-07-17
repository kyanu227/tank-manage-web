import { describe, expect, it } from "vitest";
import { parseRulesBaselineCommandArguments } from "./rules-baseline-command";

const DATA_PRINCIPAL = "tank-cutover-data@example-project.iam.gserviceaccount.com";
const RULES_PRINCIPAL = "tank-cutover-rules@example-project.iam.gserviceaccount.com";
const MAIN_COMMIT = "a".repeat(40);

describe("live Rules baseline command arguments", () => {
  it("用途別principalを受理し、互いに異なることを認証前に検証する", () => {
    expect(parseRulesBaselineCommandArguments(validArguments())).toEqual({
      projectId: "example-project",
      expectedMainCommit: MAIN_COMMIT,
      expectedDataPrincipal: DATA_PRINCIPAL,
      expectedRulesPrincipal: RULES_PRINCIPAL,
      readinessEvidence: false,
    });
  });

  it("readiness evidenceは値なしの明示flagだけを受理する", () => {
    expect(parseRulesBaselineCommandArguments([
      ...validArguments(),
      "--readiness-evidence",
    ]).readinessEvidence).toBe(true);
    expect(() => parseRulesBaselineCommandArguments([
      ...validArguments(),
      "--readiness-evidence=true",
    ])).toThrow("未知の引数");
  });

  it("dataとRulesに同じprincipalを指定した場合はfail closedにする", () => {
    expect(() => parseRulesBaselineCommandArguments(validArguments([
      `--expected-rules-principal=${DATA_PRINCIPAL}`,
    ]))).toThrow("分離");
  });

  it("旧--expected-principalを未知引数として拒否する", () => {
    expect(() => parseRulesBaselineCommandArguments([
      ...validArguments(),
      `--expected-principal=${DATA_PRINCIPAL}`,
    ])).toThrow("未知の引数");
  });

  it("用途別principalが片方でも欠ける場合を拒否する", () => {
    expect(() => parseRulesBaselineCommandArguments(validArguments().filter(
      (argument) => !argument.startsWith("--expected-data-principal="),
    ))).toThrow("--expected-data-principal");
    expect(() => parseRulesBaselineCommandArguments(validArguments().filter(
      (argument) => !argument.startsWith("--expected-rules-principal="),
    ))).toThrow("--expected-rules-principal");
  });
});

function validArguments(replacements: readonly string[] = []): string[] {
  const values = [
    "--project=example-project",
    `--expected-main-commit=${MAIN_COMMIT}`,
    `--expected-data-principal=${DATA_PRINCIPAL}`,
    `--expected-rules-principal=${RULES_PRINCIPAL}`,
  ];
  replacements.forEach((replacement) => {
    const name = replacement.split("=", 1)[0];
    const index = values.findIndex((value) => value.startsWith(`${name}=`));
    if (index >= 0) values[index] = replacement;
    else values.push(replacement);
  });
  return values;
}
