import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  STAFF_OPERATION_ERROR_TEXT,
  StaffOperationError,
  getStaffOperationErrorMessage,
  logStaffOperationError,
} from "./staff-operation-error";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff々〆〤ヶ]/u;
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/gu;

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .sort();
}

type SuppliedErrorParam = Readonly<{
  file: string;
  code: keyof typeof STAFF_OPERATION_ERROR_TEXT;
  param: string;
}>;

const PR10_TANK_OPERATION_ERROR_TEXT = {
  recovery_source_log_required: {
    ja: "復元元ログが指定されていません",
    en: "A source log is required for recovery.",
    throwCount: 1,
  },
  target_log_transition_plan_unverifiable: {
    ja: "対象ログのtransitionPlanを検証できません",
    en: "The selected log's transition plan could not be verified.",
    throwCount: 1,
  },
  direct_log_aggregation_invalid: {
    ja: "直接操作ログの集計状態が不正なため編集できません",
    en: "This direct-operation log cannot be edited because its aggregation state is invalid.",
    throwCount: 1,
  },
  recovery_source_log_not_found: {
    ja: "復元元ログが存在しません",
    en: "The recovery source log does not exist.",
    throwCount: 1,
  },
  recovery_tank_log_required: {
    ja: "タンク操作ログだけ復元できます",
    en: "Only tank-operation logs can be restored.",
    throwCount: 1,
  },
  recovery_voided_revision_forbidden: {
    ja: "取消済み revision には戻せません",
    en: "A voided revision cannot be restored.",
    throwCount: 1,
  },
  recovery_generated_revision_forbidden: {
    ja: "自動補完されたrevisionへは直接復元できません",
    en: "An automatically generated recovery revision cannot be restored directly.",
    throwCount: 1,
  },
  recovery_unofficial_revision_forbidden: {
    ja: "正式集計状態を確認できないrevisionへは復元できません",
    en: "A revision whose official aggregation state cannot be verified cannot be restored.",
    throwCount: 1,
  },
  recovery_chain_mismatch: {
    ja: "同一チェーン内のログだけ復元できます",
    en: "Only a log in the same revision chain can be restored.",
    throwCount: 1,
  },
  log_original_at_missing: {
    ja: "対象ログのoriginalAtがありません",
    en: "The selected log does not have originalAt.",
    throwCount: 1,
  },
  log_timestamp_missing: {
    ja: "対象ログのtimestampがありません",
    en: "The selected log does not have a timestamp.",
    throwCount: 1,
  },
  ordered_lend_transaction_required: {
    ja: "受注貸出は受注transactionの完了処理でだけ実行できます",
    en: "An order-based lend operation can only run when completing its order transaction.",
    throwCount: 1,
  },
  inspection_date_update_forbidden: {
    ja: "耐圧日情報は耐圧検査操作でだけ更新できます",
    en: "Pressure-test date fields can only be updated by an inspection operation.",
    throwCount: 1,
  },
  carry_over_previous_customer_projection_invalid: {
    ja: "持ち越し前の顧客projectionが不正です",
    en: "The customer projection before carry-over is invalid.",
    throwCount: 2,
  },
  log_transition_plan_unverifiable: {
    ja: "transitionPlanを検証できないログは編集・取消できません",
    en: "Logs whose transition plan cannot be verified cannot be edited or voided.",
    throwCount: 1,
  },
  log_revision_created_at_missing: {
    ja: "対象ログの作成日時を確認できません",
    en: "The selected log's creation time could not be verified.",
    throwCount: 1,
  },
} as const;

describe("staff operation error localization", () => {
  it("keeps all 17 PR-10 guards as coded throws with exact ja/en catalog text", () => {
    const tankOperationSource = readFileSync(
      join(process.cwd(), "src/lib/tank-operation.ts"),
      "utf8",
    );
    let throwCount = 0;

    Object.entries(PR10_TANK_OPERATION_ERROR_TEXT).forEach(([
      code,
      expected,
    ]) => {
      const typedCode = code as keyof typeof STAFF_OPERATION_ERROR_TEXT;
      expect(STAFF_OPERATION_ERROR_TEXT[typedCode].ja, `${code}.ja`).toBe(expected.ja);
      expect(STAFF_OPERATION_ERROR_TEXT[typedCode].en, `${code}.en`).toBe(expected.en);
      const codedThrow = `throw new StaffOperationError("${code}")`;
      const occurrences = tankOperationSource.split(codedThrow).length - 1;
      expect(occurrences, `${code} throw count`).toBe(expected.throwCount);
      throwCount += occurrences;
    });

    expect(throwCount).toBe(17);
    expect(tankOperationSource).not.toContain('throw new Error("');
  });

  it("keeps complete ja/en text and matching placeholders for every code", () => {
    Object.entries(STAFF_OPERATION_ERROR_TEXT).forEach(([code, text]) => {
      expect(Object.keys(text).sort(), code).toEqual(["en", "ja"]);
      expect(text.ja.trim(), `${code}.ja`).not.toBe("");
      expect(text.en.trim(), `${code}.en`).not.toBe("");
      expect(placeholders(text.en), `${code} placeholders`).toEqual(
        placeholders(text.ja),
      );
      expect(text.en, `${code}.en`).not.toMatch(JAPANESE_TEXT);
    });
  });

  it("renders known actionable validations specifically in both locales", () => {
    const reason = new StaffOperationError("reason_too_short", {
      params: { minLength: 5 },
    });
    expect(getStaffOperationErrorMessage(reason, "ja")).toBe(
      "理由は5文字以上で入力してください",
    );
    expect(getStaffOperationErrorMessage(reason, "en")).toBe(
      "Enter a reason of at least 5 characters.",
    );

    const transition = new StaffOperationError("operation_not_allowed", {
      params: { tankId: "A-01", status: "filled", action: "return" },
      message: "[A-01] 現在の状態「filled」では「return」を実行できません。",
    });
    expect(getStaffOperationErrorMessage(transition, "ja")).toBe(
      "[A-01] 現在の状態「filled」では「return」を実行できません。",
    );
    expect(getStaffOperationErrorMessage(transition, "en")).toBe(
      "Tank A-01 cannot run Return while its status is Filled.",
    );
    expect(getStaffOperationErrorMessage(transition, "en")).not.toMatch(
      JAPANESE_TEXT,
    );
  });

  it("localizes operation status/action params in the Japanese catalog default", () => {
    const transition = new StaffOperationError("operation_not_allowed", {
      params: { tankId: "A-01", status: "filled", action: "return" },
    });

    expect(getStaffOperationErrorMessage(transition, "ja")).toBe(
      "[A-01] ステータス「充填済み」のタンクには「返却」を実行できません",
    );
  });

  it("identifies the invalid tank ID without exposing the Japanese validation reason in English", () => {
    const error = new StaffOperationError("invalid_tank_id", {
      params: { tankId: "BAD/01" },
      message: "[BAD/01] タンクIDを入力してください",
    });

    expect(getStaffOperationErrorMessage(error, "ja")).toBe(
      "[BAD/01] タンクIDを入力してください",
    );
    expect(getStaffOperationErrorMessage(error, "en")).toBe(
      "Tank ID BAD/01 is invalid. Review the tank number.",
    );
    expect(getStaffOperationErrorMessage(error, "en")).not.toMatch(JAPANESE_TEXT);
  });

  it("preserves a legacy Error message in Japanese and uses the safe fallback in English", () => {
    const unknown = new Error("projects/secret/databases/internal: 内部エラー");

    expect(getStaffOperationErrorMessage(unknown, "ja")).toBe(
      "projects/secret/databases/internal: 内部エラー",
    );
    expect(getStaffOperationErrorMessage(unknown, "en")).toBe(
      "The operation could not be completed. Contact an administrator if the problem persists.",
    );
    expect(getStaffOperationErrorMessage(unknown, "en")).not.toContain("projects/");
    expect(getStaffOperationErrorMessage(unknown, "en")).not.toContain("try again");
  });

  it("uses an operation-scoped fallback only for unknown English errors", () => {
    const unknown = new Error("内部エラー");
    const typed = new StaffOperationError("reason_too_short", {
      params: { minLength: 5 },
    });

    expect(getStaffOperationErrorMessage(unknown, "ja", {
      unknownMessage: "一括返却を完了できませんでした。",
    })).toBe("内部エラー");
    expect(getStaffOperationErrorMessage(unknown, "en", {
      unknownMessage: "Bulk return could not be completed.",
    })).toBe("Bulk return could not be completed.");
    expect(getStaffOperationErrorMessage(typed, "en", {
      unknownMessage: "Bulk return could not be completed.",
    })).toBe("Enter a reason of at least 5 characters.");
  });

  it("handles prototype-stripped typed errors without throwing", () => {
    const missingParams = {
      name: "StaffOperationError",
      code: "operation_not_allowed",
    };
    const staleSubclass = {
      name: "StaleTankCycleError",
      staffOperationErrorBrand: "StaffOperationError",
      code: "stale_tank_cycle",
      message: "タンクの貸出cycleが操作候補の作成後に変更されています。",
    };
    const brandedSubclass = {
      name: "FutureStaffError",
      staffOperationErrorBrand: "StaffOperationError",
      code: "stale_tank_cycle",
    };
    const nullParams = {
      name: "StaffOperationError",
      code: "operation_not_allowed",
      params: null,
    };
    const malformedParams = {
      name: "StaffOperationError",
      code: "operation_not_allowed",
      params: { tankId: [], status: {}, action: false },
    };

    expect(() => getStaffOperationErrorMessage(missingParams, "en")).not.toThrow();
    expect(() => getStaffOperationErrorMessage(nullParams, "en")).not.toThrow();
    expect(() => getStaffOperationErrorMessage(malformedParams, "en")).not.toThrow();
    expect(getStaffOperationErrorMessage(missingParams, "en")).toBe(
      "The operation could not be completed. Contact an administrator if the problem persists.",
    );
    expect(getStaffOperationErrorMessage(staleSubclass, "en")).toBe(
      "The tank's rental cycle changed after it was selected. Reload and review the tank.",
    );
    expect(getStaffOperationErrorMessage(brandedSubclass, "en")).toBe(
      "The tank's rental cycle changed after it was selected. Reload and review the tank.",
    );
  });

  it("renders every param supplied by a production throw site in both locale templates", () => {
    const suppliedParams = collectSuppliedErrorParams(join(process.cwd(), "src"));
    expect(suppliedParams.length).toBeGreaterThan(0);

    suppliedParams.forEach(({ file, code, param }) => {
      expect(placeholders(STAFF_OPERATION_ERROR_TEXT[code].ja), `${file}: ${code}.${param}.ja`).toContain(param);
      expect(placeholders(STAFF_OPERATION_ERROR_TEXT[code].en), `${file}: ${code}.${param}.en`).toContain(param);
    });
  });

  it("logs the original error and cause without putting the cause in the UI", () => {
    const cause = new Error("Firestore path: tanks/internal-id");
    const error = new StaffOperationError("tank_not_found", {
      params: { tankId: "A-01" },
      cause,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    logStaffOperationError("operation failed", error);

    expect(consoleError).toHaveBeenCalledWith(
      "operation failed",
      error,
      "cause",
      cause,
    );
    expect(getStaffOperationErrorMessage(error, "en")).not.toContain("Firestore");
    expect(getStaffOperationErrorMessage(error, "en")).not.toContain("internal-id");
    consoleError.mockRestore();
  });
});

function collectSuppliedErrorParams(root: string): SuppliedErrorParam[] {
  return collectTypeScriptFiles(root).flatMap((file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const params: SuppliedErrorParam[] = [];

    function visit(node: ts.Node): void {
      if (
        ts.isNewExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "StaffOperationError"
      ) {
        const [codeNode, optionsNode] = node.arguments ?? [];
        if (
          codeNode
          && ts.isStringLiteral(codeNode)
          && codeNode.text in STAFF_OPERATION_ERROR_TEXT
          && optionsNode
          && ts.isObjectLiteralExpression(optionsNode)
        ) {
          const paramsProperty = optionsNode.properties.find((property) => (
            ts.isPropertyAssignment(property)
            && property.name.getText(source) === "params"
          ));
          if (
            paramsProperty
            && ts.isPropertyAssignment(paramsProperty)
            && ts.isObjectLiteralExpression(paramsProperty.initializer)
          ) {
            paramsProperty.initializer.properties.forEach((property) => {
              if (
                ts.isPropertyAssignment(property)
                || ts.isShorthandPropertyAssignment(property)
              ) {
                params.push({
                  file,
                  code: codeNode.text as keyof typeof STAFF_OPERATION_ERROR_TEXT,
                  param: property.name.getText(source).replaceAll(/["']/g, ""),
                });
              }
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(source);
    return params;
  });
}

function collectTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) return [];
    if (/\.(?:test|spec)\.tsx?$/u.test(entry.name)) return [];
    return [path];
  });
}
