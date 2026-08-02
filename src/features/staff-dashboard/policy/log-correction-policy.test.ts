import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  canCorrectLogReason,
  canModifyLog,
  canModifyLogReason,
  type LogCorrectionPolicyEntry,
} from "@/features/staff-dashboard/policy/log-correction-policy";
import {
  readTypeScriptSource,
  visitTypeScriptNodes,
} from "@/features/staff-dashboard/testing/typescript-source";
import { CORRECTION_LIMIT_MS } from "@/lib/tank-operation-limits";

const POLICY_PATH =
  "src/features/staff-dashboard/policy/log-correction-policy.ts";
const NOW_MS = 1_800_000_000_000;

function directLog(
  overrides: Partial<LogCorrectionPolicyEntry> = {},
): LogCorrectionPolicyEntry {
  return {
    logKind: "tank",
    logStatus: "active",
    revisionCreatedAt: NOW_MS,
    transitionPlan: { kind: "direct" },
    transitionReviewStatus: "not_required",
    ...overrides,
  };
}

describe("staff dashboard log correction policy", () => {
  it.each([
    "一般staff相当",
    "管理者相当",
  ])("%sでも72時間超は訂正・取消不可", () => {
    const log = directLog({
      revisionCreatedAt: NOW_MS - CORRECTION_LIMIT_MS - 1,
    });

    expect(canModifyLog(log, NOW_MS)).toBe(false);
    expect(canModifyLogReason(log, NOW_MS)).toBe("edit_expired");
    expect(canCorrectLogReason(log, NOW_MS)).toBe("edit_expired");
  });

  it.each([
    "一般staff相当",
    "管理者相当",
  ])("%sでも72時間以内は訂正・取消可能", () => {
    const log = directLog({
      revisionCreatedAt: NOW_MS - CORRECTION_LIMIT_MS + 1,
    });

    expect(canModifyLog(log, NOW_MS)).toBe(true);
    expect(canModifyLogReason(log, NOW_MS)).toBeNull();
    expect(canCorrectLogReason(log, NOW_MS)).toBeNull();
  });

  it.each([
    ["72時間 - 1ms", CORRECTION_LIMIT_MS - 1, null],
    ["ちょうど72時間", CORRECTION_LIMIT_MS, null],
    ["72時間 + 1ms", CORRECTION_LIMIT_MS + 1, "edit_expired"],
  ] as const)("境界値 %s を固定する", (_label, ageMs, expected) => {
    const log = directLog({ revisionCreatedAt: NOW_MS - ageMs });

    expect(canModifyLogReason(log, NOW_MS)).toBe(expected);
    expect(canCorrectLogReason(log, NOW_MS)).toBe(expected);
  });

  it("recovery logは直接訂正できず、既存の取消対象条件は維持する", () => {
    const log = directLog({ transitionPlan: { kind: "recovery" } });

    expect(canCorrectLogReason(log, NOW_MS)).toBe(
      "recovery_correction_blocked",
    );
    expect(canModifyLogReason(log, NOW_MS)).toBeNull();
  });

  it.each(["pending", "approved", "excluded"] as const)(
    "transitionReviewStatus=%sは直接訂正できない",
    (transitionReviewStatus) => {
      const log = directLog({ transitionReviewStatus });

      expect(canCorrectLogReason(log, NOW_MS)).toBe(
        "review_correction_blocked",
      );
    },
  );

  it.each(["superseded", "voided"] as const)(
    "logStatus=%sは訂正・取消できない",
    (logStatus) => {
      const log = directLog({ logStatus });

      expect(canModifyLog(log, NOW_MS)).toBe(false);
      expect(canModifyLogReason(log, NOW_MS)).toBe("inactive_log");
      expect(canCorrectLogReason(log, NOW_MS)).toBe("inactive_log");
    },
  );

  it("非tank logは訂正・取消できない", () => {
    const log = directLog({ logKind: "order" });

    expect(canModifyLog(log, NOW_MS)).toBe(false);
    expect(canModifyLogReason(log, NOW_MS)).toBe("not_tank_log");
    expect(canCorrectLogReason(log, NOW_MS)).toBe("not_tank_log");
  });

  it("transitionPlanを確認できないlogは直接訂正できない", () => {
    const log = directLog({ transitionPlan: undefined });

    expect(canCorrectLogReason(log, NOW_MS)).toBe(
      "transition_plan_missing",
    );
  });

  it.each([
    ["欠落", undefined],
    ["Invalid Date", new Date(Number.NaN)],
    ["不正文字列", "not-a-date"],
    ["無限大", Number.POSITIVE_INFINITY],
  ])("revisionCreatedAtが%sならfail-closed", (_label, revisionCreatedAt) => {
    const log = directLog({ revisionCreatedAt });

    expect(canModifyLog(log, NOW_MS)).toBe(false);
    expect(canModifyLogReason(log, NOW_MS)).toBe("missing_created_at");
    expect(canCorrectLogReason(log, NOW_MS)).toBe("missing_created_at");
  });

  it("policy moduleは時刻・role・表示・UI・Firestoreに依存しない", () => {
    const sourceFile = readTypeScriptSource(POLICY_PATH);
    const forbiddenModuleParts = [
      "react",
      "locale",
      "firebase",
      "session",
    ];

    sourceFile.statements.forEach((statement) => {
      if (!ts.isImportDeclaration(statement)) return;
      const moduleName = (statement.moduleSpecifier as ts.StringLiteral).text;
      forbiddenModuleParts.forEach((part) => {
        expect(moduleName.toLowerCase()).not.toContain(part);
      });
    });

    visitTypeScriptNodes(sourceFile, (node) => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "Date"
        && node.expression.name.text === "now"
      ) {
        throw new Error("Date.now is forbidden in correction policy");
      }
      if (ts.isIdentifier(node)) {
        expect(node.text.toLowerCase()).not.toBe("role");
      }
    });

    const policyFunctions = sourceFile.statements.filter(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement)
        && statement.name != null
        && [
          "canModifyLog",
          "canModifyLogReason",
          "canCorrectLogReason",
        ].includes(statement.name.text),
    );
    expect(policyFunctions).toHaveLength(3);
    policyFunctions.forEach((declaration) => {
      expect(
        declaration.parameters.map((parameter) =>
          parameter.name.getText(sourceFile)
        ),
      ).toStrictEqual(["log", "nowMs"]);
    });
  });
});
