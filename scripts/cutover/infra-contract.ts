import { isAbsolute } from "node:path";
import {
  DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
  RULES_READER_REQUIRED_IAM_PERMISSIONS,
  assertDistinctCutoverPrincipals,
} from "./migration-credential";

export const CUTOVER_PROJECT_ID = "okmarine-tankrental" as const;
export const CUTOVER_DATA_SERVICE_ACCOUNT_ID = "transition-cutover-data" as const;
export const CUTOVER_RULES_SERVICE_ACCOUNT_ID = "transition-rules-reader" as const;
export const CUTOVER_DATA_ROLE_ID = "transitionCutoverData" as const;
export const CUTOVER_RULES_ROLE_ID = "transitionRulesBaselineRead" as const;
export const CUTOVER_INFRA_CONFIRMATION = "PREPARE_TRANSITION_CUTOVER_INFRA" as const;

const MAX_BINDING_DURATION_MS = 24 * 60 * 60 * 1_000;
const SERVICE_ACCOUNT_DOMAIN = `${CUTOVER_PROJECT_ID}.iam.gserviceaccount.com`;

export const CUTOVER_INFRA_CONTRACT = {
  projectId: CUTOVER_PROJECT_ID,
  serviceAccounts: {
    data: {
      id: CUTOVER_DATA_SERVICE_ACCOUNT_ID,
      email: `${CUTOVER_DATA_SERVICE_ACCOUNT_ID}@${SERVICE_ACCOUNT_DOMAIN}`,
    },
    rules: {
      id: CUTOVER_RULES_SERVICE_ACCOUNT_ID,
      email: `${CUTOVER_RULES_SERVICE_ACCOUNT_ID}@${SERVICE_ACCOUNT_DOMAIN}`,
    },
  },
  roles: {
    data: {
      id: CUTOVER_DATA_ROLE_ID,
      name: `projects/${CUTOVER_PROJECT_ID}/roles/${CUTOVER_DATA_ROLE_ID}`,
      permissions: DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
    },
    rules: {
      id: CUTOVER_RULES_ROLE_ID,
      name: `projects/${CUTOVER_PROJECT_ID}/roles/${CUTOVER_RULES_ROLE_ID}`,
      permissions: RULES_READER_REQUIRED_IAM_PERMISSIONS,
    },
  },
} as const;

export type IamPrincipal = `user:${string}` | `serviceAccount:${string}`;

export type CutoverInfraCommonArguments = {
  projectId: typeof CUTOVER_PROJECT_ID;
  expectedOperatorPrincipal: IamPrincipal;
  rulesDeployPrincipal: IamPrincipal;
  bindingExpiresAt: string;
  keyId: string;
  snapshotDirectory: string;
  dataPrincipal: typeof CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email;
  rulesPrincipal: typeof CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email;
};

export type CutoverInfraPlanArguments = CutoverInfraCommonArguments & {
  command: "plan";
};

export type CutoverInfraApplyArguments = CutoverInfraCommonArguments & {
  command: "apply";
  execute: true;
  confirmation: typeof CUTOVER_INFRA_CONFIRMATION;
};

export type CutoverReadinessArguments = CutoverInfraCommonArguments & {
  command: "readiness";
  expectedMainCommit: string;
  databaseId: string;
  expectedDatabaseUid: string;
  humanEvidencePath?: string;
  rulesBaselineEvidencePath?: string;
  dataPreflightEvidencePath?: string;
};

export type ContractTimeOptions = {
  now?: Date;
};

const COMMON_VALUE_ARGUMENT_NAMES = [
  "--project",
  "--expected-operator-principal",
  "--rules-deploy-principal",
  "--binding-expires-at",
  "--key-id",
  "--snapshot-directory",
] as const;

const READINESS_VALUE_ARGUMENT_NAMES = [
  ...COMMON_VALUE_ARGUMENT_NAMES,
  "--expected-main-commit",
  "--database",
  "--expected-database-uid",
  "--human-evidence",
  "--rules-baseline-evidence",
  "--data-preflight-evidence",
] as const;

export function parseCutoverInfraPlanArguments(
  argv: readonly string[],
  options: ContractTimeOptions = {},
): CutoverInfraPlanArguments {
  const values = parseStrictArguments(argv, COMMON_VALUE_ARGUMENT_NAMES, []);
  return {
    command: "plan",
    ...parseCommonArguments(values, options),
  };
}

/** --executeと完全一致する確認文字列を、外部accessより前に純粋関数で検証する。 */
export function parseCutoverInfraApplyArguments(
  argv: readonly string[],
  options: ContractTimeOptions = {},
): CutoverInfraApplyArguments {
  const values = parseStrictArguments(
    argv,
    [...COMMON_VALUE_ARGUMENT_NAMES, "--confirm"],
    ["--execute"],
  );
  if (!values.flags.has("--execute")) {
    throw new Error("infra applyには--executeが必要です");
  }
  const confirmation = requiredValue(values, "--confirm");
  if (confirmation !== CUTOVER_INFRA_CONFIRMATION) {
    throw new Error(`infra applyには--confirm=${CUTOVER_INFRA_CONFIRMATION}が必要です`);
  }
  return {
    command: "apply",
    ...parseCommonArguments(values, options),
    execute: true,
    confirmation: CUTOVER_INFRA_CONFIRMATION,
  };
}

export function parseCutoverReadinessArguments(
  argv: readonly string[],
  options: ContractTimeOptions = {},
): CutoverReadinessArguments {
  const values = parseStrictArguments(argv, READINESS_VALUE_ARGUMENT_NAMES, []);
  const expectedMainCommit = requiredValue(values, "--expected-main-commit");
  if (!/^[0-9a-f]{40}$/u.test(expectedMainCommit)) {
    throw new Error("--expected-main-commitには40文字のGit SHAが必要です");
  }
  const databaseId = requiredValue(values, "--database");
  if (
    databaseId !== "(default)"
    && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u.test(databaseId)
  ) {
    throw new Error("--databaseが不正です");
  }
  const expectedDatabaseUid = requiredValue(values, "--expected-database-uid");
  if (expectedDatabaseUid.includes("\0") || expectedDatabaseUid.length > 512) {
    throw new Error("--expected-database-uidが不正です");
  }
  return {
    command: "readiness",
    ...parseCommonArguments(values, options),
    expectedMainCommit,
    databaseId,
    expectedDatabaseUid,
    ...optionalAbsolutePath(values, "--human-evidence", "human evidence"),
    ...optionalAbsolutePath(values, "--rules-baseline-evidence", "Rules baseline evidence"),
    ...optionalAbsolutePath(values, "--data-preflight-evidence", "data preflight evidence"),
  };
}

export function assertCutoverInfraPrincipalSeparation(input: {
  dataPrincipal: string;
  rulesPrincipal: string;
  rulesDeployPrincipal: string;
}): {
  dataPrincipal: string;
  rulesPrincipal: string;
  rulesDeployPrincipal: IamPrincipal;
} {
  const principals = assertDistinctCutoverPrincipals({
    expectedDataPrincipal: input.dataPrincipal,
    expectedRulesPrincipal: input.rulesPrincipal,
  });
  const rulesDeployPrincipal = requireIamPrincipal(
    input.rulesDeployPrincipal,
    "Rules deploy principal",
  );
  const rulesDeployIdentity = principalIdentity(rulesDeployPrincipal);
  if (
    rulesDeployIdentity === principals.expectedDataPrincipal
    || rulesDeployIdentity === principals.expectedRulesPrincipal
  ) {
    throw new Error("Rules deploy principalはdata・Rules reader principalから分離してください");
  }
  return {
    dataPrincipal: principals.expectedDataPrincipal,
    rulesPrincipal: principals.expectedRulesPrincipal,
    rulesDeployPrincipal,
  };
}

export const REQUIRED_HUMAN_WRITER_IDS = [
  "cloud_functions",
  "cloud_run_services",
  "cloud_run_jobs",
  "app_engine",
  "cloud_scheduler",
  "workflows",
  "pubsub_eventarc_cloud_tasks",
  "firebase_extensions",
  "ci_other_repositories",
  "local_scripts_cron",
  "manual_rest_rpc",
  "gas",
  "make",
  "zapier",
  "other_computers",
  "owner_manual_writes",
] as const;

export const REQUIRED_HUMAN_CONFIRMATION_IDS = [
  ...REQUIRED_HUMAN_WRITER_IDS.map((id) => `writer:${id}`),
  "adminSdkCredentialReview",
  "firebaseCliSessionReview",
  "groupMembershipReview",
  "inheritedIamReview",
  "auditLogObservationWindow",
  "snapshotKeyRecoveryDrill",
] as const;

export type HumanWriterId = typeof REQUIRED_HUMAN_WRITER_IDS[number];
export type HumanWriterStatus = "confirmed_stopped" | "absent" | "unknown";
export type HumanConfirmationStatus = "confirmed" | "unknown";

export type CutoverHumanEvidence = {
  version: 1;
  projectId: typeof CUTOVER_PROJECT_ID | null;
  mainCommit: string | null;
  keyId: string | null;
  expectedOperatorPrincipal: IamPrincipal | null;
  rulesDeployPrincipal: IamPrincipal | null;
  reviewedAt: string | null;
  reviewerPrincipal: IamPrincipal | null;
  writers: Record<HumanWriterId, HumanWriterStatus>;
  adminSdkCredentialReview: HumanConfirmationStatus;
  firebaseCliSessionReview: HumanConfirmationStatus;
  groupMembershipReview: HumanConfirmationStatus;
  inheritedIamReview: HumanConfirmationStatus;
  auditLogObservationWindow: HumanConfirmationStatus;
  snapshotKeyRecoveryDrill: HumanConfirmationStatus;
};

/** 記入されていない証跡をabsentやconfirmedと推測せず、必ずunknownへ正規化する。 */
export function parseCutoverHumanEvidence(value: unknown): CutoverHumanEvidence {
  if (value === undefined || value === null) return emptyHumanEvidence();
  const root = objectRecord(value, "human evidence");
  assertOnlyKeys(root, [
    "version",
    "projectId",
    "mainCommit",
    "keyId",
    "expectedOperatorPrincipal",
    "rulesDeployPrincipal",
    "reviewedAt",
    "reviewerPrincipal",
    "writers",
    "adminSdkCredentialReview",
    "firebaseCliSessionReview",
    "groupMembershipReview",
    "inheritedIamReview",
    "auditLogObservationWindow",
    "snapshotKeyRecoveryDrill",
  ], "human evidence");
  if (root.version !== 1) {
    throw new Error("human evidence versionが不正です");
  }
  const projectId = parseNullableHumanProjectId(root.projectId);
  const mainCommit = parseNullableHumanMainCommit(root.mainCommit);
  const keyId = parseNullableHumanKeyId(root.keyId);
  const expectedOperatorPrincipal = parseNullableHumanPrincipal(
    root.expectedOperatorPrincipal,
    "expectedOperatorPrincipal",
    true,
  );
  const rulesDeployPrincipal = parseNullableHumanPrincipal(
    root.rulesDeployPrincipal,
    "rulesDeployPrincipal",
    false,
  );
  const reviewedAt = parseNullableHumanTimestamp(root.reviewedAt);
  const reviewerPrincipal = parseNullableHumanPrincipal(
    root.reviewerPrincipal,
    "reviewerPrincipal",
    true,
  );
  const rawWriters = root.writers === undefined
    ? {}
    : objectRecord(root.writers, "human evidence writers");
  assertOnlyKeys(rawWriters, REQUIRED_HUMAN_WRITER_IDS, "human evidence writers");
  const writers = Object.fromEntries(REQUIRED_HUMAN_WRITER_IDS.map((id) => [
    id,
    parseWriterStatus(rawWriters[id], id),
  ])) as Record<HumanWriterId, HumanWriterStatus>;
  return {
    version: 1,
    projectId,
    mainCommit,
    keyId,
    expectedOperatorPrincipal,
    rulesDeployPrincipal,
    reviewedAt,
    reviewerPrincipal,
    writers,
    adminSdkCredentialReview: parseConfirmationStatus(
      root.adminSdkCredentialReview,
      "adminSdkCredentialReview",
    ),
    firebaseCliSessionReview: parseConfirmationStatus(
      root.firebaseCliSessionReview,
      "firebaseCliSessionReview",
    ),
    groupMembershipReview: parseConfirmationStatus(
      root.groupMembershipReview,
      "groupMembershipReview",
    ),
    inheritedIamReview: parseConfirmationStatus(
      root.inheritedIamReview,
      "inheritedIamReview",
    ),
    auditLogObservationWindow: parseConfirmationStatus(
      root.auditLogObservationWindow,
      "auditLogObservationWindow",
    ),
    snapshotKeyRecoveryDrill: parseConfirmationStatus(
      root.snapshotKeyRecoveryDrill,
      "snapshotKeyRecoveryDrill",
    ),
  };
}

function parseCommonArguments(
  values: ParsedStrictArguments,
  options: ContractTimeOptions,
): CutoverInfraCommonArguments {
  const projectId = requiredValue(values, "--project");
  if (projectId !== CUTOVER_PROJECT_ID) {
    throw new Error(`cutover infraのprojectは${CUTOVER_PROJECT_ID}に固定されています`);
  }
  const expectedOperatorPrincipal = requireHumanOperatorPrincipal(
    requiredValue(values, "--expected-operator-principal"),
    "expected operator principal",
  );
  const separated = assertCutoverInfraPrincipalSeparation({
    dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
    rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
    rulesDeployPrincipal: requiredValue(values, "--rules-deploy-principal"),
  });
  const operatorIdentity = principalIdentity(expectedOperatorPrincipal);
  if (
    operatorIdentity === separated.dataPrincipal
    || operatorIdentity === separated.rulesPrincipal
  ) {
    throw new Error("operator principalはdata・Rules reader principalから分離してください");
  }
  const bindingExpiresAt = requireTemporaryBindingExpiration(
    requiredValue(values, "--binding-expires-at"),
    options.now ?? new Date(),
  );
  const keyId = requiredValue(values, "--key-id");
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(keyId)) {
    throw new Error("--key-idは英数字・._-だけで指定してください");
  }
  const snapshotDirectory = requiredAbsolutePath(
    requiredValue(values, "--snapshot-directory"),
    "--snapshot-directory",
  );
  return {
    projectId: CUTOVER_PROJECT_ID,
    expectedOperatorPrincipal,
    rulesDeployPrincipal: separated.rulesDeployPrincipal,
    bindingExpiresAt,
    keyId,
    snapshotDirectory,
    dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
    rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
  };
}

export function requireTemporaryBindingExpiration(value: string, now: Date): string {
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u.exec(
    normalized,
  );
  if (!match) throw new Error("--binding-expires-atにはRFC3339 UTC timestampが必要です");
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  const expiresAtMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  );
  const parsed = new Date(expiresAtMs);
  if (
    !Number.isFinite(expiresAtMs)
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    throw new Error("--binding-expires-atが不正なUTC timestampです");
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("現在時刻が不正です");
  if (expiresAtMs <= nowMs) throw new Error("IAM binding期限は未来である必要があります");
  if (expiresAtMs - nowMs > MAX_BINDING_DURATION_MS) {
    throw new Error("IAM binding期限は現在から24時間以内である必要があります");
  }
  return normalized;
}

type ParsedStrictArguments = {
  values: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
};

function parseStrictArguments(
  argv: readonly string[],
  valueNames: readonly string[],
  flagNames: readonly string[],
): ParsedStrictArguments {
  const allowedValues = new Set(valueNames);
  const allowedFlags = new Set(flagNames);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  argv.forEach((argument) => {
    if (allowedFlags.has(argument)) {
      if (flags.has(argument)) throw new Error(`引数を重複指定できません: ${argument}`);
      flags.add(argument);
      return;
    }
    const separator = argument.indexOf("=");
    const name = separator < 0 ? argument : argument.slice(0, separator);
    if (!allowedValues.has(name) || separator < 0) {
      throw new Error(`未知または不正な引数です: ${name}`);
    }
    if (values.has(name)) throw new Error(`引数を重複指定できません: ${name}`);
    values.set(name, argument.slice(separator + 1).trim());
  });
  return { values, flags };
}

function requiredValue(values: ParsedStrictArguments, name: string): string {
  const value = values.values.get(name)?.trim();
  if (!value) throw new Error(`${name}=<value>は必須です`);
  return value;
}

function optionalAbsolutePath(
  values: ParsedStrictArguments,
  name: string,
  label: string,
): Record<string, string> {
  const value = values.values.get(name);
  if (value === undefined) return {};
  const propertyByName: Record<string, string> = {
    "--human-evidence": "humanEvidencePath",
    "--rules-baseline-evidence": "rulesBaselineEvidencePath",
    "--data-preflight-evidence": "dataPreflightEvidencePath",
  };
  return {
    [propertyByName[name]]: requiredAbsolutePath(value, label),
  };
}

function requiredAbsolutePath(value: string, label: string): string {
  if (!value || value.includes("\0") || !isAbsolute(value)) {
    throw new Error(`${label}は絶対pathで指定してください`);
  }
  return value;
}

function requireIamPrincipal(value: string, label: string): IamPrincipal {
  const normalized = value.trim();
  const match = /^(user|serviceAccount):([^\s:@]+@[^\s:@]+)$/u.exec(normalized);
  if (!match || match[2] !== match[2].toLowerCase()) {
    throw new Error(`${label}には正規化済みIAM principalを指定してください`);
  }
  const [, kind, email] = match;
  const serviceAccountEmail = email.endsWith(".gserviceaccount.com");
  if (
    (kind === "serviceAccount" && !serviceAccountEmail)
    || (kind === "user" && serviceAccountEmail)
  ) {
    throw new Error(`${label}のIAM principal種別とemailが一致しません`);
  }
  return normalized as IamPrincipal;
}

function requireHumanOperatorPrincipal(value: string, label: string): IamPrincipal {
  const principal = requireIamPrincipal(value, label);
  if (!principal.startsWith("user:")) {
    throw new Error(`${label}には人間のuser principalが必要です`);
  }
  return principal;
}

function principalIdentity(principal: IamPrincipal): string {
  return principal.slice(principal.indexOf(":") + 1);
}

function emptyHumanEvidence(): CutoverHumanEvidence {
  return {
    version: 1,
    projectId: null,
    mainCommit: null,
    keyId: null,
    expectedOperatorPrincipal: null,
    rulesDeployPrincipal: null,
    reviewedAt: null,
    reviewerPrincipal: null,
    writers: Object.fromEntries(REQUIRED_HUMAN_WRITER_IDS.map((id) => [id, "unknown"])) as Record<
      HumanWriterId,
      HumanWriterStatus
    >,
    adminSdkCredentialReview: "unknown",
    firebaseCliSessionReview: "unknown",
    groupMembershipReview: "unknown",
    inheritedIamReview: "unknown",
    auditLogObservationWindow: "unknown",
    snapshotKeyRecoveryDrill: "unknown",
  };
}

/** CLI parserだけでなくservice公開境界でも固定project・identity・期限を再検証する。 */
export function assertCutoverInfraCommonContract(
  value: unknown,
  options: ContractTimeOptions = {},
): asserts value is CutoverInfraCommonArguments {
  const root = objectRecord(value, "cutover infra arguments");
  if (
    root.projectId !== CUTOVER_PROJECT_ID
    || root.dataPrincipal !== CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email
    || root.rulesPrincipal !== CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email
  ) throw new Error("cutover infra fixed contractが不正です");
  const expectedOperatorPrincipal = requireHumanOperatorPrincipal(
    requireRuntimeString(root.expectedOperatorPrincipal, "expected operator principal"),
    "expected operator principal",
  );
  const separated = assertCutoverInfraPrincipalSeparation({
    dataPrincipal: root.dataPrincipal,
    rulesPrincipal: root.rulesPrincipal,
    rulesDeployPrincipal: requireRuntimeString(root.rulesDeployPrincipal, "Rules deploy principal"),
  });
  const operatorIdentity = principalIdentity(expectedOperatorPrincipal);
  if (
    operatorIdentity === separated.dataPrincipal
    || operatorIdentity === separated.rulesPrincipal
  ) throw new Error("operator principalはdata・Rules reader principalから分離してください");
  const expiresAt = requireRuntimeString(root.bindingExpiresAt, "bindingExpiresAt");
  if (requireTemporaryBindingExpiration(expiresAt, options.now ?? new Date()) !== expiresAt) {
    throw new Error("bindingExpiresAtが正規化されていません");
  }
  const keyId = requireRuntimeString(root.keyId, "keyId");
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(keyId)) throw new Error("keyIdが不正です");
  requiredAbsolutePath(requireRuntimeString(root.snapshotDirectory, "snapshotDirectory"), "snapshotDirectory");
}

/** CLI parserだけでなくservice公開境界でもmutation許可を再検証する。 */
export function assertCutoverInfraApplyAuthorization(
  value: unknown,
  options: ContractTimeOptions = {},
): asserts value is CutoverInfraApplyArguments {
  const root = objectRecord(value, "infra apply arguments");
  if (
    root.command !== "apply"
    || root.execute !== true
    || root.confirmation !== CUTOVER_INFRA_CONFIRMATION
  ) {
    throw new Error("infra apply authorizationが不正です");
  }
  assertCutoverInfraCommonContract(root, options);
}

function requireRuntimeString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label}が不正です`);
  }
  return value;
}

function parseNullableHumanProjectId(value: unknown): typeof CUTOVER_PROJECT_ID | null {
  if (value === undefined || value === null) return null;
  if (value !== CUTOVER_PROJECT_ID) throw new Error("human evidence projectIdが不正です");
  return CUTOVER_PROJECT_ID;
}

function parseNullableHumanMainCommit(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error("human evidence mainCommitが不正です");
  }
  return value;
}

function parseNullableHumanKeyId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/u.test(value)) {
    throw new Error("human evidence keyIdが不正です");
  }
  return value;
}

function parseNullableHumanTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error("human evidence reviewedAtが不正です");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) throw new Error("human evidence reviewedAtが不正です");
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0")),
  );
  const parsed = new Date(timestamp);
  if (
    !Number.isFinite(timestamp)
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) throw new Error("human evidence reviewedAtが不正です");
  return value;
}

function parseNullableHumanPrincipal(
  value: unknown,
  label: string,
  requireHumanUser: boolean,
): IamPrincipal | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`human evidence ${label}が不正です`);
  const principal = requireIamPrincipal(value, `human evidence ${label}`);
  if (requireHumanUser && !principal.startsWith("user:")) {
    throw new Error(`human evidence ${label}には人間のuser principalが必要です`);
  }
  return principal;
}

function parseWriterStatus(value: unknown, id: HumanWriterId): HumanWriterStatus {
  if (value === undefined) return "unknown";
  if (value === "confirmed_stopped" || value === "absent" || value === "unknown") return value;
  throw new Error(`human evidence writer ${id}のstatusが不正です`);
}

function parseConfirmationStatus(value: unknown, label: string): HumanConfirmationStatus {
  if (value === undefined) return "unknown";
  if (value === "confirmed" || value === "unknown") return value;
  throw new Error(`human evidence ${label}のstatusが不正です`);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}はobjectである必要があります`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label}に未知のfieldがあります`);
  }
}
