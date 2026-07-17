import { canonicalSha256 } from "./canonical-firestore-value";
import {
  CUTOVER_INFRA_CONTRACT,
  REQUIRED_HUMAN_CONFIRMATION_IDS,
  assertCutoverInfraApplyAuthorization,
  assertCutoverInfraCommonContract,
  type CutoverInfraApplyArguments,
  type CutoverInfraCommonArguments,
} from "./infra-contract";
import {
  createGcloudInfraMutationAdapter,
  createGcloudInfraReadAdapter,
  type GcloudCustomRole,
  type GcloudIamBinding,
  type GcloudIamCondition,
  type GcloudIamPolicy,
  type GcloudInfraMutationAdapter,
  type GcloudInfraReadAdapter,
  type GcloudLookup,
  type GcloudServiceAccount,
} from "./gcloud-infra-adapter";
import {
  createSnapshotKeychainEntry,
  inspectLocalSnapshotDirectory,
  inspectSnapshotKeychainEntry,
  inventoryRepositoryServiceAccountCredentials,
  type LocalCutoverEnvironmentDependencies,
  type RepositoryServiceAccountCredentialInventory,
} from "./local-cutover-environment";

const DATA_SA_DISPLAY_NAME = "Transition cutover data migration";
const DATA_SA_DESCRIPTION = "Temporary staff-only transition cutover data principal";
const RULES_SA_DISPLAY_NAME = "Transition cutover Rules reader";
const RULES_SA_DESCRIPTION = "Temporary read-only live Rules baseline principal";
const DATA_ROLE_TITLE = "Transition Cutover Data";
const DATA_ROLE_DESCRIPTION = "Exact Firestore data permissions for transition cutover";
const RULES_ROLE_TITLE = "Transition Rules Baseline Read";
const RULES_ROLE_DESCRIPTION = "Exact Firebase Rules read permissions for cutover baseline";
const DATA_WRITE_SERVICE = "datastore.googleapis.com";
const DATA_WRITE_LOG_TYPE = "DATA_WRITE";
const TOKEN_CREATOR_ROLE = "roles/iam.serviceAccountTokenCreator";
const TARGET_SA_IMPERSONATION_SURFACE_ROLES = new Set([
  TOKEN_CREATOR_ROLE,
  "roles/iam.serviceAccountOpenIdTokenCreator",
  "roles/iam.workloadIdentityUser",
  "roles/iam.serviceAccountUser",
]);

export type CutoverInfraAction =
  | "create_data_service_account"
  | "create_rules_service_account"
  | "create_data_custom_role"
  | "create_rules_custom_role"
  | "set_project_policy"
  | "set_data_service_account_policy"
  | "set_rules_service_account_policy"
  | "create_snapshot_keychain_entry";

export type CutoverInfraPlanReport = {
  mode: "read-only-infra-plan";
  project: { projectId: string; projectNumber: string; active: boolean };
  resources: {
    dataServiceAccount: "missing" | "exact";
    rulesServiceAccount: "missing" | "exact";
    dataCustomRole: "missing" | "exact";
    rulesCustomRole: "missing" | "exact";
    projectBindings: "missing" | "exact";
    dataImpersonationBinding: "missing" | "exact";
    rulesImpersonationBinding: "missing" | "exact";
    dataWriteAuditLogs: "missing" | "exact";
    snapshotKeychainEntry: "missing" | "present";
    snapshotDirectory: "local_apfs_non_synced";
  };
  actions: CutoverInfraAction[];
  applyBlockers: string[];
  readinessBlockers: string[];
  humanConfirmationRequired: string[];
  credentialInventory: {
    fileCount: number;
    serviceAccounts: Array<{
      principal: string | null;
      activeUserManagedKeyCount: number | null;
      lastUseConfirmable: false;
      rotationRecommended: boolean;
    }>;
    uninspectableCandidateCount: number;
    skippedSymlinkCount: number;
  };
  evidenceSha256: string;
};

type CutoverInfraPlanInternal = {
  report: CutoverInfraPlanReport;
  projectPolicy: GcloudIamPolicy;
  dataServiceAccountPolicy: GcloudIamPolicy | null;
  rulesServiceAccountPolicy: GcloudIamPolicy | null;
};

export type CutoverInfraServiceDependencies = {
  readAdapter?: GcloudInfraReadAdapter;
  mutationAdapter?: GcloudInfraMutationAdapter;
  local?: LocalCutoverEnvironmentDependencies;
};

export async function planCutoverInfrastructure(
  input: { args: CutoverInfraCommonArguments; repositoryRoot: string },
  dependencies: CutoverInfraServiceDependencies = {},
): Promise<CutoverInfraPlanReport> {
  assertCutoverInfraCommonContract(input.args);
  return (await collectPlan(input, dependencies)).report;
}

/**
 * resource作成は非atomic。全driftをmutation前に検査し、曖昧な失敗時はblind retryしない。
 * 本関数はFirestore document、Rules、Hosting、既存credentialへ変更を加えない。
 */
export async function applyCutoverInfrastructure(
  input: { args: CutoverInfraApplyArguments; repositoryRoot: string },
  dependencies: CutoverInfraServiceDependencies = {},
): Promise<CutoverInfraPlanReport> {
  assertCutoverInfraApplyAuthorization(input.args);
  const mutation = dependencies.mutationAdapter ?? createGcloudInfraMutationAdapter({
    expectedOperatorAccount: principalAccount(input.args.expectedOperatorPrincipal),
    expectedProjectId: input.args.projectId,
  });
  let plan = await collectPlan(input, dependencies);
  assertApplySafe(plan.report);

  if (plan.report.actions.includes("create_data_service_account")) {
    await mutation.createServiceAccount({
      projectId: input.args.projectId,
      accountId: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.id,
      displayName: DATA_SA_DISPLAY_NAME,
      description: DATA_SA_DESCRIPTION,
    });
  }
  if (plan.report.actions.includes("create_rules_service_account")) {
    await mutation.createServiceAccount({
      projectId: input.args.projectId,
      accountId: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.id,
      displayName: RULES_SA_DISPLAY_NAME,
      description: RULES_SA_DESCRIPTION,
    });
  }
  if (plan.report.actions.includes("create_data_custom_role")) {
    await mutation.createCustomRole({
      projectId: input.args.projectId,
      roleId: CUTOVER_INFRA_CONTRACT.roles.data.id,
      title: DATA_ROLE_TITLE,
      description: DATA_ROLE_DESCRIPTION,
      includedPermissions: CUTOVER_INFRA_CONTRACT.roles.data.permissions,
      stage: "GA",
    });
  }
  if (plan.report.actions.includes("create_rules_custom_role")) {
    await mutation.createCustomRole({
      projectId: input.args.projectId,
      roleId: CUTOVER_INFRA_CONTRACT.roles.rules.id,
      title: RULES_ROLE_TITLE,
      description: RULES_ROLE_DESCRIPTION,
      includedPermissions: CUTOVER_INFRA_CONTRACT.roles.rules.permissions,
      stage: "GA",
    });
  }

  // 作成resourceを再読取し、一件でも期待契約と異なればpolicyを付与しない。
  plan = await collectPlan(input, dependencies);
  assertApplySafe(plan.report);
  const unresolvedCreateActions = plan.report.actions.filter((action) => (
    action === "create_data_service_account"
    || action === "create_rules_service_account"
    || action === "create_data_custom_role"
    || action === "create_rules_custom_role"
  ));
  if (
    unresolvedCreateActions.length > 0
    || !plan.dataServiceAccountPolicy
    || !plan.rulesServiceAccountPolicy
  ) {
    throw new Error("作成resourceの完全一致を再読取できないためpolicy付与を停止しました");
  }

  if (plan.report.actions.includes("set_project_policy")) {
    const desired = desiredProjectPolicy(plan.projectPolicy, input.args);
    await mutation.setProjectIamPolicyOnce({
      projectId: input.args.projectId,
      completePolicy: desired,
      expectedEtag: desired.etag,
      expectedVersion: desired.version,
    });
  }
  if (plan.report.actions.includes("set_data_service_account_policy")) {
    if (!plan.dataServiceAccountPolicy) throw new Error("data SA policyを取得できません");
    const desired = desiredServiceAccountPolicy(
      plan.dataServiceAccountPolicy,
      input.args,
      "data",
    );
    await mutation.setServiceAccountIamPolicyOnce({
      projectId: input.args.projectId,
      serviceAccountEmail: input.args.dataPrincipal,
      completePolicy: desired,
      expectedEtag: desired.etag,
      expectedVersion: desired.version,
    });
  }
  if (plan.report.actions.includes("set_rules_service_account_policy")) {
    if (!plan.rulesServiceAccountPolicy) throw new Error("Rules SA policyを取得できません");
    const desired = desiredServiceAccountPolicy(
      plan.rulesServiceAccountPolicy,
      input.args,
      "rules",
    );
    await mutation.setServiceAccountIamPolicyOnce({
      projectId: input.args.projectId,
      serviceAccountEmail: input.args.rulesPrincipal,
      completePolicy: desired,
      expectedEtag: desired.etag,
      expectedVersion: desired.version,
    });
  }

  plan = await collectPlan(input, dependencies);
  assertApplySafe(plan.report);
  const remainingCloudActions = plan.report.actions.filter((action) => (
    action !== "create_snapshot_keychain_entry"
  ));
  if (remainingCloudActions.length > 0) {
    throw new Error("infra apply後のcloud resource完全一致を確認できません");
  }
  if (plan.report.actions.includes("create_snapshot_keychain_entry")) {
    await createSnapshotKeychainEntry({
      projectId: input.args.projectId,
      keyId: input.args.keyId,
    }, dependencies.local);
  }

  const finalPlan = await collectPlan(input, dependencies);
  assertApplySafe(finalPlan.report);
  if (finalPlan.report.actions.length > 0) {
    throw new Error("infra apply後の完全一致を確認できません");
  }
  return finalPlan.report;
}

async function collectPlan(
  input: { args: CutoverInfraCommonArguments; repositoryRoot: string },
  dependencies: CutoverInfraServiceDependencies,
): Promise<CutoverInfraPlanInternal> {
  const read = dependencies.readAdapter ?? createGcloudInfraReadAdapter();
  const args = input.args;
  const [
    activeConfiguration,
    project,
    dataServiceAccount,
    rulesServiceAccount,
    dataCustomRole,
    rulesCustomRole,
    projectPolicy,
    ancestors,
    credentialInventory,
    snapshotDirectory,
    keychain,
  ] = await Promise.all([
    read.getActiveConfiguration(),
    read.describeProject(args.projectId),
    read.describeServiceAccount(args.projectId, args.dataPrincipal),
    read.describeServiceAccount(args.projectId, args.rulesPrincipal),
    read.describeCustomRole(args.projectId, CUTOVER_INFRA_CONTRACT.roles.data.id),
    read.describeCustomRole(args.projectId, CUTOVER_INFRA_CONTRACT.roles.rules.id),
    read.getProjectIamPolicy(args.projectId),
    read.listProjectAncestors(args.projectId),
    inventoryRepositoryServiceAccountCredentials({ repositoryRoot: input.repositoryRoot }),
    inspectLocalSnapshotDirectory({
      snapshotDirectory: args.snapshotDirectory,
      repositoryRoot: input.repositoryRoot,
    }, dependencies.local),
    inspectSnapshotKeychainEntry({ projectId: args.projectId, keyId: args.keyId }, dependencies.local),
  ]);
  if (project.projectId !== args.projectId) throw new Error("gcloud projectがexpected projectと一致しません");

  const ancestorPolicies = await Promise.all(
    ancestors
      .filter((ancestor) => ancestor.type !== "project")
      .map(async (ancestor) => ({ ancestor, policy: await read.getAncestorIamPolicy(ancestor) })),
  );
  const [dataSaPolicy, rulesSaPolicy, dataKeyCount, rulesKeyCount] = await Promise.all([
    dataServiceAccount.status === "found"
      ? read.getServiceAccountIamPolicy(args.projectId, args.dataPrincipal)
      : Promise.resolve(null),
    rulesServiceAccount.status === "found"
      ? read.getServiceAccountIamPolicy(args.projectId, args.rulesPrincipal)
      : Promise.resolve(null),
    dataServiceAccount.status === "found"
      ? read.inspectUserManagedKeys(args.projectId, args.dataPrincipal)
      : Promise.resolve({ totalCount: 0, activeCount: 0, unverifiableCount: 0 }),
    rulesServiceAccount.status === "found"
      ? read.inspectUserManagedKeys(args.projectId, args.rulesPrincipal)
      : Promise.resolve({ totalCount: 0, activeCount: 0, unverifiableCount: 0 }),
  ]);

  const actions: CutoverInfraAction[] = [];
  const applyBlockers: string[] = [];
  const readinessBlockers: string[] = [];
  const humanConfirmationRequired = [...REQUIRED_HUMAN_CONFIRMATION_IDS];
  if (
    project.parent
    && !ancestors.some((ancestor) => (
      ancestor.type === project.parent!.type && ancestor.id === project.parent!.id
    ))
  ) {
    applyBlockers.push("ANCESTOR_INVENTORY_INCOMPLETE");
  }
  const expectedOperatorAccount = principalAccount(args.expectedOperatorPrincipal);
  if (
    activeConfiguration.account.toLowerCase() !== expectedOperatorAccount.toLowerCase()
    || activeConfiguration.projectId !== args.projectId
  ) {
    applyBlockers.push("ACTIVE_GCLOUD_CONFIGURATION_MISMATCH");
  }

  const dataSaStatus = assessServiceAccount(dataServiceAccount, {
    email: args.dataPrincipal,
    displayName: DATA_SA_DISPLAY_NAME,
    description: DATA_SA_DESCRIPTION,
  }, "data", actions, applyBlockers);
  const rulesSaStatus = assessServiceAccount(rulesServiceAccount, {
    email: args.rulesPrincipal,
    displayName: RULES_SA_DISPLAY_NAME,
    description: RULES_SA_DESCRIPTION,
  }, "rules", actions, applyBlockers);
  if (dataKeyCount.totalCount !== 0) applyBlockers.push("DATA_SA_HAS_USER_MANAGED_KEYS");
  if (rulesKeyCount.totalCount !== 0) applyBlockers.push("RULES_SA_HAS_USER_MANAGED_KEYS");

  const dataRoleStatus = assessRole(dataCustomRole, {
    name: CUTOVER_INFRA_CONTRACT.roles.data.name,
    title: DATA_ROLE_TITLE,
    description: DATA_ROLE_DESCRIPTION,
    permissions: CUTOVER_INFRA_CONTRACT.roles.data.permissions,
  }, "data", actions, applyBlockers);
  const rulesRoleStatus = assessRole(rulesCustomRole, {
    name: CUTOVER_INFRA_CONTRACT.roles.rules.name,
    title: RULES_ROLE_TITLE,
    description: RULES_ROLE_DESCRIPTION,
    permissions: CUTOVER_INFRA_CONTRACT.roles.rules.permissions,
  }, "rules", actions, applyBlockers);

  const projectBindings = assessProjectBindings(projectPolicy, args, actions, applyBlockers);
  const dataImpersonation = dataSaPolicy
    ? assessServiceAccountPolicy(dataSaPolicy, args, "data", actions, applyBlockers)
    : "missing";
  const rulesImpersonation = rulesSaPolicy
    ? assessServiceAccountPolicy(rulesSaPolicy, args, "rules", actions, applyBlockers)
    : "missing";
  const audit = assessAuditPolicies(
    projectPolicy,
    ancestorPolicies.map(({ policy }) => policy),
    actions,
    applyBlockers,
  );
  assessAncestorAccess(
    [projectPolicy, ...ancestorPolicies.map(({ policy }) => policy)],
    args,
    applyBlockers,
  );
  if (containsGroupBindings([projectPolicy, ...ancestorPolicies.map(({ policy }) => policy)])) {
    readinessBlockers.push("GROUP_MEMBERSHIP_REQUIRES_HUMAN_EVIDENCE");
  }
  if (credentialInventory.credentialFileCount > 0) {
    readinessBlockers.push("REPOSITORY_ADMIN_SDK_CREDENTIALS_REQUIRE_REVIEW");
  }
  if (credentialInventory.uninspectableCandidateCount > 0) {
    readinessBlockers.push("UNINSPECTABLE_CREDENTIAL_CANDIDATE");
  }
  if (project.lifecycleState !== "ACTIVE") applyBlockers.push("PROJECT_NOT_ACTIVE");
  if (!keychain.exists) actions.push("create_snapshot_keychain_entry");

  const credentialReport = await credentialInventoryReport(credentialInventory, read, args.projectId);
  const reportWithoutHash = {
    mode: "read-only-infra-plan" as const,
    project: {
      projectId: project.projectId,
      projectNumber: project.projectNumber,
      active: project.lifecycleState === "ACTIVE",
    },
    resources: {
      dataServiceAccount: dataSaStatus,
      rulesServiceAccount: rulesSaStatus,
      dataCustomRole: dataRoleStatus,
      rulesCustomRole: rulesRoleStatus,
      projectBindings,
      dataImpersonationBinding: dataImpersonation,
      rulesImpersonationBinding: rulesImpersonation,
      dataWriteAuditLogs: audit,
      snapshotKeychainEntry: keychain.exists ? "present" as const : "missing" as const,
      snapshotDirectory: snapshotDirectory.fileSystem === "apfs"
        ? "local_apfs_non_synced" as const
        : "local_apfs_non_synced" as const,
    },
    actions: uniqueSorted(actions),
    applyBlockers: uniqueSorted(applyBlockers),
    readinessBlockers: uniqueSorted(readinessBlockers),
    humanConfirmationRequired,
    credentialInventory: credentialReport,
  };
  return {
    report: {
      ...reportWithoutHash,
      evidenceSha256: canonicalSha256(reportWithoutHash),
    },
    projectPolicy,
    dataServiceAccountPolicy: dataSaPolicy,
    rulesServiceAccountPolicy: rulesSaPolicy,
  };
}

function assessServiceAccount(
  lookup: GcloudLookup<GcloudServiceAccount>,
  expected: { email: string; displayName: string; description: string },
  kind: "data" | "rules",
  actions: CutoverInfraAction[],
  blockers: string[],
): "missing" | "exact" {
  if (lookup.status === "not_found") {
    actions.push(kind === "data" ? "create_data_service_account" : "create_rules_service_account");
    return "missing";
  }
  const value = lookup.value;
  if (
    value.email !== expected.email
    || value.displayName !== expected.displayName
    || value.description !== expected.description
    || value.disabled
  ) {
    blockers.push(kind === "data" ? "DATA_SERVICE_ACCOUNT_DRIFT" : "RULES_SERVICE_ACCOUNT_DRIFT");
  }
  return "exact";
}

function assessRole(
  lookup: GcloudLookup<GcloudCustomRole>,
  expected: {
    name: string;
    title: string;
    description: string;
    permissions: readonly string[];
  },
  kind: "data" | "rules",
  actions: CutoverInfraAction[],
  blockers: string[],
): "missing" | "exact" {
  if (lookup.status === "not_found") {
    actions.push(kind === "data" ? "create_data_custom_role" : "create_rules_custom_role");
    return "missing";
  }
  const role = lookup.value;
  if (
    role.name !== expected.name
    || role.title !== expected.title
    || role.description !== expected.description
    || role.stage !== "GA"
    || role.deleted
    || !sameStrings(role.includedPermissions, expected.permissions)
  ) blockers.push(kind === "data" ? "DATA_CUSTOM_ROLE_DRIFT" : "RULES_CUSTOM_ROLE_DRIFT");
  return "exact";
}

function assessProjectBindings(
  policy: GcloudIamPolicy,
  args: CutoverInfraCommonArguments,
  actions: CutoverInfraAction[],
  blockers: string[],
): "missing" | "exact" {
  const dataExpected = {
    member: `serviceAccount:${args.dataPrincipal}`,
    role: CUTOVER_INFRA_CONTRACT.roles.data.name,
    condition: expectedCondition("data", args.bindingExpiresAt),
  };
  const rulesExpected = {
    member: `serviceAccount:${args.rulesPrincipal}`,
    role: CUTOVER_INFRA_CONTRACT.roles.rules.name,
    condition: expectedCondition("rules", args.bindingExpiresAt),
  };
  // role側とprincipal側の両方を排他検査し、別principalへの専用role付与と
  // target SAへのOwner/Editor等の追加roleをいずれも拒否する。
  const dataRole = assessExclusiveRoleBinding(
    policy,
    dataExpected,
    "DATA_PROJECT_BINDING_DRIFT",
    blockers,
  );
  const dataPrincipal = assessPrincipalBinding(
    policy,
    dataExpected,
    "DATA_PROJECT_BINDING_DRIFT",
    blockers,
  );
  const rulesRole = assessExclusiveRoleBinding(
    policy,
    rulesExpected,
    "RULES_PROJECT_BINDING_DRIFT",
    blockers,
  );
  const rulesPrincipal = assessPrincipalBinding(
    policy,
    rulesExpected,
    "RULES_PROJECT_BINDING_DRIFT",
    blockers,
  );
  const data = dataRole === "missing" || dataPrincipal === "missing" ? "missing" : "exact";
  const rules = rulesRole === "missing" || rulesPrincipal === "missing" ? "missing" : "exact";
  if (data === "missing" || rules === "missing") {
    actions.push("set_project_policy");
    return "missing";
  }
  return "exact";
}

/** Dedicated custom roleは期待SAへの期限付きbinding一件だけを許可する。 */
function assessExclusiveRoleBinding(
  policy: GcloudIamPolicy,
  expected: { member: string; role: string; condition: GcloudIamCondition },
  driftCode: string,
  blockers: string[],
): "missing" | "exact" {
  const bindings = policy.bindings.filter((binding) => binding.role === expected.role);
  if (bindings.length === 0) return "missing";
  if (
    bindings.length !== 1
    || !bindingExactlyMatches(bindings[0], expected)
  ) blockers.push(driftCode);
  return "exact";
}

function assessServiceAccountPolicy(
  policy: GcloudIamPolicy,
  args: CutoverInfraCommonArguments,
  kind: "data" | "rules",
  actions: CutoverInfraAction[],
  blockers: string[],
): "missing" | "exact" {
  const expected = {
    member: args.expectedOperatorPrincipal,
    role: TOKEN_CREATOR_ROLE,
    condition: expectedCondition(`${kind}-impersonation`, args.bindingExpiresAt),
  };
  const status = assessPrincipalBinding(
    policy,
    expected,
    kind === "data" ? "DATA_IMPERSONATION_BINDING_DRIFT" : "RULES_IMPERSONATION_BINDING_DRIFT",
    blockers,
  );
  if (status === "missing") {
    actions.push(kind === "data"
      ? "set_data_service_account_policy"
      : "set_rules_service_account_policy");
  }
  // Dedicated target SAではoperator以外のToken Creator bindingを許可しない。
  if (policy.bindings.some((binding) => (
    binding.role === TOKEN_CREATOR_ROLE
    && !binding.members.includes(args.expectedOperatorPrincipal)
  ))) {
    blockers.push(kind === "data"
      ? "DATA_IMPERSONATION_EXTRA_BINDING"
      : "RULES_IMPERSONATION_EXTRA_BINDING");
  }
  const exact = policy.bindings.filter((binding) => bindingExactlyMatches(binding, expected));
  if (policy.bindings.length !== exact.length) {
    blockers.push(kind === "data"
      ? "DATA_SERVICE_ACCOUNT_POLICY_DRIFT"
      : "RULES_SERVICE_ACCOUNT_POLICY_DRIFT");
  }
  return status;
}

function assessPrincipalBinding(
  policy: GcloudIamPolicy,
  expected: { member: string; role: string; condition: GcloudIamCondition },
  driftCode: string,
  blockers: string[],
): "missing" | "exact" {
  const bindings = policy.bindings.filter((binding) => binding.members.includes(expected.member));
  if (bindings.length === 0) return "missing";
  if (
    bindings.length !== 1
    || !bindingExactlyMatches(bindings[0], expected)
  ) blockers.push(driftCode);
  return "exact";
}

function assessAuditPolicies(
  projectPolicy: GcloudIamPolicy,
  ancestorPolicies: readonly GcloudIamPolicy[],
  actions: CutoverInfraAction[],
  blockers: string[],
): "missing" | "exact" {
  for (const policy of [projectPolicy, ...ancestorPolicies]) {
    for (const config of policy.auditConfigs ?? []) {
      if (config.service !== DATA_WRITE_SERVICE && config.service !== "allServices") continue;
      for (const log of config.auditLogConfigs) {
        if (log.logType === DATA_WRITE_LOG_TYPE && (log.exemptedMembers?.length ?? 0) > 0) {
          blockers.push("DATA_WRITE_AUDIT_EXEMPTION_PRESENT");
        }
      }
    }
  }
  const datastoreConfigs = (projectPolicy.auditConfigs ?? [])
    .filter((config) => config.service === DATA_WRITE_SERVICE);
  if (datastoreConfigs.length > 1) {
    blockers.push("DATA_WRITE_AUDIT_CONFIG_DRIFT");
    return "exact";
  }
  const dataWriteConfigs = datastoreConfigs.length === 1
    ? datastoreConfigs[0].auditLogConfigs.filter((log) => log.logType === DATA_WRITE_LOG_TYPE)
    : [];
  const hasExact = dataWriteConfigs.length === 1
    && (dataWriteConfigs[0].exemptedMembers?.length ?? 0) === 0;
  if (dataWriteConfigs.length > 1) blockers.push("DATA_WRITE_AUDIT_CONFIG_DRIFT");
  if (!hasExact) {
    actions.push("set_project_policy");
    return "missing";
  }
  return "exact";
}

function assessAncestorAccess(
  policies: readonly GcloudIamPolicy[],
  args: CutoverInfraCommonArguments,
  blockers: string[],
): void {
  const members = new Set([
    `serviceAccount:${args.dataPrincipal}`,
    `serviceAccount:${args.rulesPrincipal}`,
  ]);
  policies.forEach((policy, policyIndex) => policy.bindings.forEach((binding) => {
    if (TARGET_SA_IMPERSONATION_SURFACE_ROLES.has(binding.role)) {
      blockers.push("TARGET_SA_EFFECTIVE_IMPERSONATION_SURFACE");
    }
    if (
      (policyIndex > 0 && binding.members.some((member) => members.has(member)))
      || binding.members.includes("allUsers")
      || binding.members.includes("allAuthenticatedUsers")
    ) blockers.push("INHERITED_OR_BROAD_IAM_ACCESS");
  }));
}

function desiredProjectPolicy(
  policy: GcloudIamPolicy,
  args: CutoverInfraCommonArguments,
): GcloudIamPolicy {
  const next = clonePolicy(policy);
  next.version = 3;
  addBindingIfMissing(next, {
    role: CUTOVER_INFRA_CONTRACT.roles.data.name,
    members: [`serviceAccount:${args.dataPrincipal}`],
    condition: expectedCondition("data", args.bindingExpiresAt),
  });
  addBindingIfMissing(next, {
    role: CUTOVER_INFRA_CONTRACT.roles.rules.name,
    members: [`serviceAccount:${args.rulesPrincipal}`],
    condition: expectedCondition("rules", args.bindingExpiresAt),
  });
  const auditConfigs = next.auditConfigs ?? [];
  let datastore = auditConfigs.find((config) => config.service === DATA_WRITE_SERVICE);
  if (!datastore) {
    datastore = { service: DATA_WRITE_SERVICE, auditLogConfigs: [] };
    auditConfigs.push(datastore);
  }
  if (!datastore.auditLogConfigs.some((log) => log.logType === DATA_WRITE_LOG_TYPE)) {
    datastore.auditLogConfigs.push({ logType: DATA_WRITE_LOG_TYPE });
  }
  next.auditConfigs = auditConfigs;
  return next;
}

function desiredServiceAccountPolicy(
  policy: GcloudIamPolicy,
  args: CutoverInfraCommonArguments,
  kind: "data" | "rules",
): GcloudIamPolicy {
  const next = clonePolicy(policy);
  next.version = 3;
  addBindingIfMissing(next, {
    role: TOKEN_CREATOR_ROLE,
    members: [args.expectedOperatorPrincipal],
    condition: expectedCondition(`${kind}-impersonation`, args.bindingExpiresAt),
  });
  return next;
}

function addBindingIfMissing(policy: GcloudIamPolicy, binding: GcloudIamBinding): void {
  if (!policy.bindings.some((current) => bindingExactlyMatches(current, {
    member: binding.members[0],
    role: binding.role,
    condition: binding.condition!,
  }))) policy.bindings.push(binding);
}

function expectedCondition(kind: string, expiresAt: string): GcloudIamCondition {
  return {
    title: `transition-cutover-${kind}-expiry`,
    description: "Temporary transition cutover access; remove after cutover",
    expression: `request.time < timestamp(\"${expiresAt}\")`,
  };
}

function bindingExactlyMatches(
  binding: GcloudIamBinding,
  expected: { member: string; role: string; condition: GcloudIamCondition },
): boolean {
  return binding.role === expected.role
    && binding.members.length === 1
    && binding.members[0] === expected.member
    && binding.condition?.title === expected.condition.title
    && binding.condition?.description === expected.condition.description
    && binding.condition?.expression === expected.condition.expression;
}

function containsGroupBindings(policies: readonly GcloudIamPolicy[]): boolean {
  return policies.some((policy) => policy.bindings.some((binding) => (
    binding.members.some((member) => member.startsWith("group:"))
  )));
}

async function credentialInventoryReport(
  inventory: RepositoryServiceAccountCredentialInventory,
  read: GcloudInfraReadAdapter,
  projectId: string,
): Promise<CutoverInfraPlanReport["credentialInventory"]> {
  const unique = [...new Map(inventory.credentials.map((credential, index) => [
    credential.clientEmail ?? `unknown-${index}`,
    credential,
  ])).values()];
  const serviceAccounts = await Promise.all(unique.map(async (credential) => {
    const sameProject = credential.projectId === projectId && credential.clientEmail !== null;
    const keyInventory = sameProject
      ? await read.inspectUserManagedKeys(projectId, credential.clientEmail!)
      : null;
    return {
      principal: credential.clientEmail,
      activeUserManagedKeyCount: keyInventory?.activeCount ?? null,
      lastUseConfirmable: false as const,
      rotationRecommended: credential.hasLocalKeyId
        || (keyInventory?.totalCount ?? 0) > 0
        || (keyInventory?.unverifiableCount ?? 0) > 0,
    };
  }));
  return {
    fileCount: inventory.credentialFileCount,
    serviceAccounts,
    uninspectableCandidateCount: inventory.uninspectableCandidateCount,
    skippedSymlinkCount: inventory.skippedSymlinkCount,
  };
}

function clonePolicy(policy: GcloudIamPolicy): GcloudIamPolicy {
  return structuredClone(policy);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

function principalAccount(principal: string): string {
  return principal.slice(principal.indexOf(":") + 1).toLowerCase();
}

function assertApplySafe(report: CutoverInfraPlanReport): void {
  if (report.applyBlockers.length > 0) {
    throw new Error("infra contract driftがあるためapplyを停止しました");
  }
}
