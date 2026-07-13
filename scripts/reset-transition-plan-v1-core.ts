export const MIGRATION_MARKER_ID = "transitionPlanRequiredV1";
export const EXECUTE_CONFIRMATION = "RESET_TRANSITION_PLAN_V1";
export const RESET_TRANSACTION_TYPES = ["order", "return", "uncharged_report"] as const;

export type ResetTransactionType = (typeof RESET_TRANSACTION_TYPES)[number];

export type ResetArguments = {
  projectId: string;
  execute: boolean;
  confirmation: string;
  backupRef: string;
  executedBy: string;
};

export type ResetLogClassification = "tank" | "preserved_non_tank" | "unknown";
export type ResetTransactionClassification = "delete" | "preserve" | "unknown";

const KNOWN_NON_TANK_LOG_KINDS = new Set(["order", "procurement"]);
const KNOWN_PRESERVED_TRANSACTION_TYPES = new Set([
  "procurement",
  "tank_purchase",
  "tank_register",
  "supply_order",
]);

export const TANK_OPERATION_PROJECTION_FIELDS = new Set([
  "status",
  "location",
  "customerId",
  "customerName",
  "latestLogId",
  "staff",
  "staffId",
  "staffName",
  "staffEmail",
  "lastOperationStaffId",
  "lastOperationStaffName",
  "lastOperationStaffEmail",
  "logNote",
  "updatedAt",
]);

export function parseResetArguments(argv: readonly string[]): ResetArguments {
  const projectId = argumentValue(argv, "--project");
  if (!projectId) {
    throw new Error("--project=<explicit-project-id> は必須です。既定projectには接続しません");
  }

  return {
    projectId,
    execute: argv.includes("--execute"),
    confirmation: argumentValue(argv, "--confirm"),
    backupRef: argumentValue(argv, "--backup-ref"),
    executedBy: argumentValue(argv, "--executed-by") || currentOperatorName(),
  };
}

export function validateExecuteArguments(args: ResetArguments): void {
  if (!args.execute) return;
  if (args.confirmation !== EXECUTE_CONFIRMATION) {
    throw new Error(`実行には --confirm=${EXECUTE_CONFIRMATION} が必要です`);
  }
  if (!args.backupRef) {
    throw new Error("実行には --backup-ref=<verified-backup-reference> が必要です");
  }
  if (!args.executedBy) {
    throw new Error("実行者を特定できません。--executed-by=<operator> を指定してください");
  }
}

/**
 * 現リポジトリにはbackup referenceをproject・作成時刻まで検証できる正本がない。
 * 文字列のbackupRefだけで実行可能にせず、検証方式が導入されるまでexecuteを閉じる。
 */
export function assertBackupCanBeVerified(args: ResetArguments): void {
  if (!args.execute) return;
  throw new Error(
    `backupRef「${args.backupRef}」をproject「${args.projectId}」の実在backupとして機械検証する仕組みがありません。` +
    " 検証可能なbackup registryまたはmanifestを設計するまで--executeは無効です",
  );
}

export function assertMigrationMarkerMayStart(value: unknown): void {
  const marker = value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
  if (!marker) return;
  const status = normalizedString(marker?.status);
  if (status === "completed") throw new Error("migrationは既にcompletedです");
  if (status === "in_progress") throw new Error("migrationは既にin_progressです");
  if (status === "failed") return;
  throw new Error("migration markerのstatusを検証できないため開始できません");
}

/** unknown recordをtank operationと推測せず、execute自体をfail closedにする。 */
export function assertResetPreviewHasNoUnknownRecords(input: {
  unknownLogIds: readonly string[];
  unknownTransactions: readonly { id: string; type: string }[];
}): void {
  if (input.unknownLogIds.length > 0) {
    throw new Error(
      `logKindを判定できないlogが${input.unknownLogIds.length}件あるため実行できません`,
    );
  }
  if (input.unknownTransactions.length > 0) {
    throw new Error(
      `未知のtransaction typeが${input.unknownTransactions.length}件あるため実行できません`,
    );
  }
}

export function classifyLogKind(value: unknown): ResetLogClassification {
  const kind = normalizedString(value);
  if (kind === "tank") return "tank";
  if (KNOWN_NON_TANK_LOG_KINDS.has(kind)) return "preserved_non_tank";
  return "unknown";
}

export function classifyTransactionType(value: unknown): ResetTransactionClassification {
  const type = normalizedString(value);
  if ((RESET_TRANSACTION_TYPES as readonly string[]).includes(type)) return "delete";
  if (KNOWN_PRESERVED_TRANSACTION_TYPES.has(type)) return "preserve";
  return "unknown";
}

export function tankBasicInformationSnapshot(
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => !TANK_OPERATION_PROJECTION_FIELDS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, canonicalValue(value)]),
  );
}

export function stableSnapshot(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);

  const record = value as Record<string, unknown>;
  if (typeof record.toMillis === "function") {
    return { __timestampMillis: (record.toMillis as () => number)() };
  }
  if (typeof record.path === "string" && Object.keys(record).length <= 2) {
    return { __documentPath: record.path };
  }

  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function argumentValue(argv: readonly string[], name: string): string {
  const prefix = `${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function currentOperatorName(): string {
  return process.env.USER?.trim() || process.env.LOGNAME?.trim() || "";
}
