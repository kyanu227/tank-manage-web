import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GCLOUD_TIMEOUT_MS = 30_000;
const GCLOUD_MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const POLICY_FILE_NAME = "project-policy.json";

export type GcloudInfraErrorCode =
  | "GCLOUD_NOT_FOUND"
  | "GCLOUD_TIMEOUT"
  | "GCLOUD_COMMAND_FAILED"
  | "GCLOUD_INVALID_INPUT"
  | "GCLOUD_INVALID_RESPONSE"
  | "GCLOUD_CREDENTIAL_OVERRIDE_PRESENT"
  | "GCLOUD_ACTIVE_OPERATOR_MISMATCH"
  | "GCLOUD_RESOURCE_AMBIGUOUS"
  | "GCLOUD_POLICY_ALREADY_ATTEMPTED"
  | "GCLOUD_TEMPFILE_FAILED"
  | "GCLOUD_TEMPFILE_CLEANUP_FAILED";

/** gcloudのstderrや実行pathを呼出元へ伝播させないための固定error。 */
export class GcloudInfraError extends Error {
  readonly code: GcloudInfraErrorCode;

  constructor(code: GcloudInfraErrorCode) {
    super(`cutover infrastructure command failed (${code})`);
    this.name = "GcloudInfraError";
    this.code = code;
  }
}

export type GcloudJsonValue =
  | null
  | boolean
  | number
  | string
  | GcloudJsonValue[]
  | { [key: string]: GcloudJsonValue | undefined };

export type GcloudProject = {
  projectId: string;
  projectNumber: string;
  lifecycleState: string;
  parent?: {
    type: string;
    id: string;
  };
};

export type GcloudServiceAccount = {
  email: string;
  uniqueId: string;
  displayName: string;
  description: string;
  disabled: boolean;
};

export type GcloudCustomRole = {
  name: string;
  title: string;
  description: string;
  includedPermissions: string[];
  stage: string;
  deleted: boolean;
};

export type GcloudIamCondition = {
  [key: string]: GcloudJsonValue | undefined;
  title: string;
  expression: string;
  description?: string;
};

export type GcloudIamBinding = {
  [key: string]: GcloudJsonValue | undefined;
  role: string;
  members: string[];
  condition?: GcloudIamCondition;
};

export type GcloudAuditLogConfig = {
  [key: string]: GcloudJsonValue | undefined;
  logType: string;
  exemptedMembers?: string[];
};

export type GcloudAuditConfig = {
  [key: string]: GcloudJsonValue | undefined;
  service: string;
  auditLogConfigs: GcloudAuditLogConfig[];
};

/** unknownな将来fieldも落とさずset-iam-policyへ戻せるJSON objectとして保持する。 */
export type GcloudIamPolicy = {
  [key: string]: GcloudJsonValue | undefined;
  version: number;
  etag: string;
  bindings: GcloudIamBinding[];
  auditConfigs?: GcloudAuditConfig[];
};

export type GcloudProjectAncestor = {
  type: "project" | "folder" | "organization";
  id: string;
};

export type GcloudLookup<T> =
  | { status: "found"; value: T }
  | { status: "not_found" };

export type GcloudInfraOperation =
  | "get_active_account"
  | "get_active_configuration"
  | "describe_project"
  | "describe_service_account"
  | "list_service_account_fallback"
  | "describe_custom_role"
  | "list_custom_role_fallback"
  | "get_project_iam_policy"
  | "list_project_ancestors"
  | "get_folder_iam_policy"
  | "get_organization_iam_policy"
  | "get_service_account_iam_policy"
  | "list_user_managed_keys"
  | "create_service_account"
  | "create_custom_role"
  | "set_project_iam_policy"
  | "set_service_account_iam_policy";

export type GcloudInfraProcessRequest = {
  mode: "read" | "mutation";
  operation: GcloudInfraOperation;
  args: readonly string[];
};

export type GcloudInfraProcessRunner = (
  request: GcloudInfraProcessRequest,
) => Promise<{ stdout: string }>;

export type GcloudInfraAdapterDependencies = {
  runner?: GcloudInfraProcessRunner;
  temporaryDirectoryRoot?: string;
  environment?: Readonly<Record<string, string | undefined>>;
};

export type GcloudInfraMutationAdapterDependencies = GcloudInfraAdapterDependencies & {
  expectedOperatorAccount: string;
  expectedProjectId: string;
};

export type GcloudInfraReadAdapter = {
  getActiveConfiguration(): Promise<{ account: string; projectId: string }>;
  describeProject(projectId: string): Promise<GcloudProject>;
  describeServiceAccount(
    projectId: string,
    serviceAccountEmail: string,
  ): Promise<GcloudLookup<GcloudServiceAccount>>;
  describeCustomRole(
    projectId: string,
    roleId: string,
  ): Promise<GcloudLookup<GcloudCustomRole>>;
  getProjectIamPolicy(projectId: string): Promise<GcloudIamPolicy>;
  listProjectAncestors(projectId: string): Promise<GcloudProjectAncestor[]>;
  getAncestorIamPolicy(ancestor: GcloudProjectAncestor): Promise<GcloudIamPolicy>;
  getServiceAccountIamPolicy(
    projectId: string,
    serviceAccountEmail: string,
  ): Promise<GcloudIamPolicy>;
  inspectUserManagedKeys(projectId: string, serviceAccountEmail: string): Promise<{
    totalCount: number;
    activeCount: number;
    unverifiableCount: number;
  }>;
};

export type GcloudInfraMutationAdapter = {
  createServiceAccount(input: {
    projectId: string;
    accountId: string;
    displayName: string;
    description: string;
  }): Promise<void>;
  createCustomRole(input: {
    projectId: string;
    roleId: string;
    title: string;
    description: string;
    includedPermissions: readonly string[];
    stage: "GA";
  }): Promise<void>;
  setProjectIamPolicyOnce(input: {
    projectId: string;
    completePolicy: GcloudIamPolicy;
    expectedEtag: string;
    expectedVersion: number;
  }): Promise<void>;
  setServiceAccountIamPolicyOnce(input: {
    projectId: string;
    serviceAccountEmail: string;
    completePolicy: GcloudIamPolicy;
    expectedEtag: string;
    expectedVersion: number;
  }): Promise<void>;
};

export function createGcloudInfraReadAdapter(
  dependencies: GcloudInfraAdapterDependencies = {},
): GcloudInfraReadAdapter {
  const environment = dependencies.environment ?? process.env;
  const baseRunner = dependencies.runner
    ?? ((request: GcloudInfraProcessRequest) => runGcloudProcess(request, environment));
  const runner = credentialOverrideGuardedRunner(baseRunner, environment);
  return {
    async getActiveConfiguration() {
      return readActiveConfiguration(runner);
    },

    async describeProject(projectId) {
      const normalizedProjectId = requireProjectId(projectId);
      const value = await readJson(runner, {
        mode: "read",
        operation: "describe_project",
        args: [
          "projects", "describe", normalizedProjectId,
          `--project=${normalizedProjectId}`,
          "--format=json",
          "--verbosity=error",
        ],
      });
      return parseProject(value);
    },

    async describeServiceAccount(projectId, serviceAccountEmail) {
      const normalizedProjectId = requireProjectId(projectId);
      const normalizedEmail = requireServiceAccountEmail(
        serviceAccountEmail,
        normalizedProjectId,
      );
      try {
        const value = await readJson(runner, {
          mode: "read",
          operation: "describe_service_account",
          args: [
            "iam", "service-accounts", "describe", normalizedEmail,
            `--project=${normalizedProjectId}`,
            "--format=json",
            "--verbosity=error",
          ],
        });
        return { status: "found", value: parseServiceAccount(value) };
      } catch (error) {
        if (!isCommandFailure(error)) throw error;
      }
      const matches = requireArray(await readJson(runner, {
        mode: "read",
        operation: "list_service_account_fallback",
        args: [
          "iam", "service-accounts", "list",
          `--project=${normalizedProjectId}`,
          `--filter=email=${normalizedEmail}`,
          "--limit=2",
          "--format=json",
          "--verbosity=error",
        ],
      }));
      if (matches.length === 0) return { status: "not_found" };
      throw new GcloudInfraError("GCLOUD_RESOURCE_AMBIGUOUS");
    },

    async describeCustomRole(projectId, roleId) {
      const normalizedProjectId = requireProjectId(projectId);
      const normalizedRoleId = requireRoleId(roleId);
      try {
        const value = await readJson(runner, {
          mode: "read",
          operation: "describe_custom_role",
          args: [
            "iam", "roles", "describe", normalizedRoleId,
            `--project=${normalizedProjectId}`,
            "--format=json",
            "--verbosity=error",
          ],
        });
        return { status: "found", value: parseCustomRole(value) };
      } catch (error) {
        if (!isCommandFailure(error)) throw error;
      }
      const fullRoleName = `projects/${normalizedProjectId}/roles/${normalizedRoleId}`;
      const matches = requireArray(await readJson(runner, {
        mode: "read",
        operation: "list_custom_role_fallback",
        args: [
          "iam", "roles", "list",
          `--project=${normalizedProjectId}`,
          "--show-deleted",
          `--filter=name=${fullRoleName}`,
          "--limit=2",
          "--format=json",
          "--verbosity=error",
        ],
      }));
      if (matches.length === 0) return { status: "not_found" };
      throw new GcloudInfraError("GCLOUD_RESOURCE_AMBIGUOUS");
    },

    async getProjectIamPolicy(projectId) {
      const normalizedProjectId = requireProjectId(projectId);
      return parseIamPolicy(await readJson(runner, {
        mode: "read",
        operation: "get_project_iam_policy",
        args: [
          "projects", "get-iam-policy", normalizedProjectId,
          `--project=${normalizedProjectId}`,
          "--format=json",
          "--verbosity=error",
        ],
      }));
    },

    async listProjectAncestors(projectId) {
      const normalizedProjectId = requireProjectId(projectId);
      const values = requireArray(await readJson(runner, {
        mode: "read",
        operation: "list_project_ancestors",
        args: [
          "projects", "get-ancestors", normalizedProjectId,
          `--project=${normalizedProjectId}`,
          "--format=json",
          "--verbosity=error",
        ],
      }));
      return values.map(parseProjectAncestor);
    },

    async getAncestorIamPolicy(ancestor) {
      const normalized = parseProjectAncestor(ancestor);
      if (normalized.type === "project") {
        return this.getProjectIamPolicy(normalized.id);
      }
      const operation = normalized.type === "folder"
        ? "get_folder_iam_policy"
        : "get_organization_iam_policy";
      const args = normalized.type === "folder"
        ? [
          "resource-manager", "folders", "get-iam-policy", normalized.id,
          "--format=json", "--verbosity=error",
        ]
        : [
          "organizations", "get-iam-policy", normalized.id,
          "--format=json", "--verbosity=error",
        ];
      return parseIamPolicy(await readJson(runner, {
        mode: "read",
        operation,
        args,
      }));
    },

    async getServiceAccountIamPolicy(projectId, serviceAccountEmail) {
      const normalizedProjectId = requireProjectId(projectId);
      const normalizedEmail = requireServiceAccountEmail(
        serviceAccountEmail,
        normalizedProjectId,
      );
      return parseIamPolicy(await readJson(runner, {
        mode: "read",
        operation: "get_service_account_iam_policy",
        args: [
          "iam", "service-accounts", "get-iam-policy", normalizedEmail,
          `--project=${normalizedProjectId}`,
          "--format=json",
          "--verbosity=error",
        ],
      }));
    },

    async inspectUserManagedKeys(projectId, serviceAccountEmail) {
      const normalizedProjectId = requireProjectId(projectId);
      const normalizedEmail = requireServiceAccountEmail(
        serviceAccountEmail,
        normalizedProjectId,
      );
      const keys = requireArray(await readJson(runner, {
        mode: "read",
        operation: "list_user_managed_keys",
        args: [
          "iam", "service-accounts", "keys", "list",
          `--iam-account=${normalizedEmail}`,
          "--managed-by=user",
          `--project=${normalizedProjectId}`,
          "--format=json",
          "--verbosity=error",
        ],
      }));
      const now = Date.now();
      let activeCount = 0;
      let unverifiableCount = 0;
      keys.forEach((key) => {
        const record = requireRecord(key);
        if (optionalBoolean(record.disabled)) return;
        const validAfter = Date.parse(optionalString(record.validAfterTime));
        const validBefore = Date.parse(optionalString(record.validBeforeTime));
        if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
          unverifiableCount += 1;
        } else if (validAfter <= now && now < validBefore) {
          activeCount += 1;
        }
      });
      return { totalCount: keys.length, activeCount, unverifiableCount };
    },
  };
}

export function createGcloudInfraMutationAdapter(
  dependencies: GcloudInfraMutationAdapterDependencies,
): GcloudInfraMutationAdapter {
  const expectedOperatorAccount = requireOperatorAccount(dependencies.expectedOperatorAccount);
  const expectedProjectId = requireProjectId(dependencies.expectedProjectId);
  const environment = dependencies.environment ?? process.env;
  const baseRunner = dependencies.runner
    ?? ((request: GcloudInfraProcessRequest) => runGcloudProcess(request, environment));
  const runner = credentialOverrideGuardedRunner(baseRunner, environment);
  let projectPolicyAttempted = false;
  const serviceAccountPolicyAttempts = new Set<string>();
  return {
    async createServiceAccount(input) {
      const projectId = requireProjectId(input.projectId);
      assertExpectedMutationProject(projectId, expectedProjectId);
      const accountId = requireAccountId(input.accountId);
      const displayName = requireLabel(input.displayName);
      const description = requireLabel(input.description);
      await runVerifiedMutation(runner, {
        mode: "mutation",
        operation: "create_service_account",
        args: [
          "iam", "service-accounts", "create", accountId,
          `--project=${projectId}`,
          `--display-name=${displayName}`,
          `--description=${description}`,
          "--quiet",
          "--format=json",
          "--verbosity=error",
        ],
      }, { expectedOperatorAccount, expectedProjectId });
    },

    async createCustomRole(input) {
      const projectId = requireProjectId(input.projectId);
      assertExpectedMutationProject(projectId, expectedProjectId);
      const roleId = requireRoleId(input.roleId);
      const title = requireLabel(input.title);
      const description = requireLabel(input.description);
      const permissions = requirePermissions(input.includedPermissions);
      if (input.stage !== "GA") {
        throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
      }
      await runVerifiedMutation(runner, {
        mode: "mutation",
        operation: "create_custom_role",
        args: [
          "iam", "roles", "create", roleId,
          `--project=${projectId}`,
          `--title=${title}`,
          `--description=${description}`,
          `--permissions=${permissions.join(",")}`,
          "--stage=GA",
          "--quiet",
          "--format=json",
          "--verbosity=error",
        ],
      }, { expectedOperatorAccount, expectedProjectId });
    },

    async setProjectIamPolicyOnce(input) {
      if (projectPolicyAttempted) {
        throw new GcloudInfraError("GCLOUD_POLICY_ALREADY_ATTEMPTED");
      }
      projectPolicyAttempted = true;
      const projectId = requireProjectId(input.projectId);
      assertExpectedMutationProject(projectId, expectedProjectId);
      const expectedEtag = requireEtag(input.expectedEtag);
      const expectedVersion = requireExpectedPolicyVersion(input.expectedVersion);
      const completePolicy = parseIamPolicy(input.completePolicy);
      if (
        completePolicy.etag !== expectedEtag
        || completePolicy.version !== expectedVersion
      ) {
        throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
      }
      await withTemporaryPolicyFile(
        completePolicy,
        dependencies.temporaryDirectoryRoot,
        async (policyPath) => {
          await runVerifiedMutation(runner, {
            mode: "mutation",
            operation: "set_project_iam_policy",
            args: [
              "projects", "set-iam-policy", projectId, policyPath,
              `--project=${projectId}`,
              "--quiet",
              "--format=json",
              "--verbosity=error",
            ],
          }, { expectedOperatorAccount, expectedProjectId });
        },
      );
    },

    async setServiceAccountIamPolicyOnce(input) {
      const projectId = requireProjectId(input.projectId);
      assertExpectedMutationProject(projectId, expectedProjectId);
      const serviceAccountEmail = requireServiceAccountEmail(
        input.serviceAccountEmail,
        projectId,
      );
      const attemptKey = `${projectId}/${serviceAccountEmail}`;
      if (serviceAccountPolicyAttempts.has(attemptKey)) {
        throw new GcloudInfraError("GCLOUD_POLICY_ALREADY_ATTEMPTED");
      }
      serviceAccountPolicyAttempts.add(attemptKey);
      const expectedEtag = requireEtag(input.expectedEtag);
      const expectedVersion = requireExpectedPolicyVersion(input.expectedVersion);
      const completePolicy = parseIamPolicy(input.completePolicy);
      if (
        completePolicy.etag !== expectedEtag
        || completePolicy.version !== expectedVersion
      ) {
        throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
      }
      await withTemporaryPolicyFile(
        completePolicy,
        dependencies.temporaryDirectoryRoot,
        async (policyPath) => {
          await runVerifiedMutation(runner, {
            mode: "mutation",
            operation: "set_service_account_iam_policy",
            args: [
              "iam", "service-accounts", "set-iam-policy",
              serviceAccountEmail, policyPath,
              `--project=${projectId}`,
              "--quiet",
              "--format=json",
              "--verbosity=error",
            ],
          }, { expectedOperatorAccount, expectedProjectId });
        },
      );
    },
  };
}

async function readJson(
  runner: GcloudInfraProcessRunner,
  request: GcloudInfraProcessRequest,
): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await runner(request));
  } catch (error) {
    throw sanitizeRunnerError(error);
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
}

async function readActiveConfiguration(
  runner: GcloudInfraProcessRunner,
): Promise<{ account: string; projectId: string }> {
  const accounts = requireArray(await readJson(runner, {
    mode: "read",
    operation: "get_active_account",
    args: [
      "auth", "list",
      "--filter=status:ACTIVE",
      "--format=json(account)",
      "--verbosity=error",
    ],
  }));
  if (accounts.length !== 1) {
    throw new GcloudInfraError("GCLOUD_RESOURCE_AMBIGUOUS");
  }
  const account = requireString(requireRecord(accounts[0]).account);
  const configuration = requireRecord(await readJson(runner, {
    mode: "read",
    operation: "get_active_configuration",
    args: [
      "config", "list",
      "--format=json",
      "--verbosity=error",
    ],
  }));
  assertNoConfiguredCredentialOverrides(configuration);
  const core = requireRecord(configuration.core);
  const configuredAccount = core.account === undefined
    ? account
    : requireString(core.account);
  if (configuredAccount.toLowerCase() !== account.toLowerCase()) {
    throw new GcloudInfraError("GCLOUD_RESOURCE_AMBIGUOUS");
  }
  return {
    account,
    projectId: requireProjectId(requireString(core.project)),
  };
}

async function runMutation(
  runner: GcloudInfraProcessRunner,
  request: GcloudInfraProcessRequest,
): Promise<void> {
  try {
    await runner(request);
  } catch (error) {
    throw sanitizeRunnerError(error);
  }
}

async function runVerifiedMutation(
  runner: GcloudInfraProcessRunner,
  request: GcloudInfraProcessRequest,
  expected: { expectedOperatorAccount: string; expectedProjectId: string },
): Promise<void> {
  const active = await readActiveConfiguration(runner);
  if (
    active.account.toLowerCase() !== expected.expectedOperatorAccount
    || active.projectId !== expected.expectedProjectId
  ) {
    throw new GcloudInfraError("GCLOUD_ACTIVE_OPERATOR_MISMATCH");
  }
  await runMutation(runner, {
    ...request,
    args: [...request.args, `--account=${expected.expectedOperatorAccount}`],
  });
}

function credentialOverrideGuardedRunner(
  runner: GcloudInfraProcessRunner,
  environment: Readonly<Record<string, string | undefined>>,
): GcloudInfraProcessRunner {
  return async (request) => {
    assertNoEnvironmentCredentialOverrides(environment);
    return runner(request);
  };
}

function assertNoEnvironmentCredentialOverrides(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const hasCredentialOverride = Object.entries(environment).some(([name, value]) => {
    if (!value?.trim()) return false;
    return name.startsWith("CLOUDSDK_AUTH_")
      || name === "CLOUDSDK_CONFIG"
      || name === "CLOUDSDK_ACTIVE_CONFIG_NAME"
      || name === "CLOUDSDK_CORE_ACCOUNT"
      || name === "CLOUDSDK_CORE_PROJECT"
      || name === "GOOGLE_APPLICATION_CREDENTIALS"
      || name === "GOOGLE_IMPERSONATE_SERVICE_ACCOUNT";
  });
  if (hasCredentialOverride) {
    throw new GcloudInfraError("GCLOUD_CREDENTIAL_OVERRIDE_PRESENT");
  }
}

function assertNoConfiguredCredentialOverrides(configuration: Record<string, unknown>): void {
  if (configuration.auth === undefined) return;
  const auth = requireRecord(configuration.auth);
  const hasCredentialOverride = Object.entries(auth).some(([name, value]) => {
    if (!/(?:credential|impersonat|access_token|login_config)/u.test(name)) return false;
    return value !== undefined && value !== null && value !== false && value !== "";
  });
  if (hasCredentialOverride) {
    throw new GcloudInfraError("GCLOUD_CREDENTIAL_OVERRIDE_PRESENT");
  }
}

function runGcloudProcess(
  request: GcloudInfraProcessRequest,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "gcloud",
      [...request.args],
      {
        encoding: "utf8",
        env: {
          ...environment,
          CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
        } as unknown as NodeJS.ProcessEnv,
        maxBuffer: GCLOUD_MAX_STDOUT_BYTES,
        timeout: GCLOUD_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error) {
          resolve({ stdout });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new GcloudInfraError("GCLOUD_NOT_FOUND"));
          return;
        }
        if (error.killed || error.signal) {
          reject(new GcloudInfraError("GCLOUD_TIMEOUT"));
          return;
        }
        reject(new GcloudInfraError("GCLOUD_COMMAND_FAILED"));
      },
    );
  });
}

async function withTemporaryPolicyFile(
  policy: GcloudIamPolicy,
  temporaryDirectoryRoot: string | undefined,
  action: (path: string) => Promise<void>,
): Promise<void> {
  let directory: string;
  try {
    directory = await mkdtemp(join(temporaryDirectoryRoot ?? tmpdir(), "tank-cutover-iam-"));
    await chmod(directory, 0o700);
  } catch {
    throw new GcloudInfraError("GCLOUD_TEMPFILE_FAILED");
  }
  const policyPath = join(directory, POLICY_FILE_NAME);
  try {
    try {
      await writeFile(policyPath, JSON.stringify(policy), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await chmod(policyPath, 0o600);
      const stats = await lstat(policyPath);
      if (
        !stats.isFile()
        || (stats.mode & 0o777) !== 0o600
        || stats.nlink !== 1
        || (typeof process.getuid === "function" && stats.uid !== process.getuid())
      ) {
        throw new Error("unsafe temporary file");
      }
    } catch {
      throw new GcloudInfraError("GCLOUD_TEMPFILE_FAILED");
    }
    await action(policyPath);
  } finally {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      throw new GcloudInfraError("GCLOUD_TEMPFILE_CLEANUP_FAILED");
    }
  }
}

function sanitizeRunnerError(error: unknown): GcloudInfraError {
  if (error instanceof GcloudInfraError) return error;
  if (isRecord(error)) {
    if (error.code === "ENOENT") return new GcloudInfraError("GCLOUD_NOT_FOUND");
    if (error.code === "ETIMEDOUT") return new GcloudInfraError("GCLOUD_TIMEOUT");
  }
  return new GcloudInfraError("GCLOUD_COMMAND_FAILED");
}

function isCommandFailure(error: unknown): boolean {
  return error instanceof GcloudInfraError && error.code === "GCLOUD_COMMAND_FAILED";
}

function parseProject(value: unknown): GcloudProject {
  const record = requireRecord(value);
  const parent = record.parent === undefined
    ? undefined
    : parseParent(record.parent);
  return {
    projectId: requireString(record.projectId),
    projectNumber: requireNumericId(record.projectNumber),
    lifecycleState: requireString(record.lifecycleState),
    ...(parent ? { parent } : {}),
  };
}

function parseParent(value: unknown): { type: string; id: string } {
  const record = requireRecord(value);
  return {
    type: requireString(record.type),
    id: requireNumericId(record.id),
  };
}

function parseServiceAccount(value: unknown): GcloudServiceAccount {
  const record = requireRecord(value);
  return {
    email: requireString(record.email),
    uniqueId: requireNumericId(record.uniqueId),
    displayName: optionalString(record.displayName),
    description: optionalString(record.description),
    disabled: optionalBoolean(record.disabled),
  };
}

function parseCustomRole(value: unknown): GcloudCustomRole {
  const record = requireRecord(value);
  return {
    name: requireString(record.name),
    title: requireString(record.title),
    description: optionalString(record.description),
    includedPermissions: requireStringArray(record.includedPermissions),
    stage: requireString(record.stage),
    deleted: optionalBoolean(record.deleted),
  };
}

function parseIamPolicy(value: unknown): GcloudIamPolicy {
  const record = requireJsonRecord(value);
  const version = record.version === undefined ? 1 : requirePolicyVersion(record.version);
  const etag = record.etag === undefined ? "" : requireString(record.etag);
  const bindings = record.bindings === undefined
    ? []
    : requireArray(record.bindings).map(parseIamBinding);
  const auditConfigs = record.auditConfigs === undefined
    ? undefined
    : requireArray(record.auditConfigs).map(parseAuditConfig);
  return {
    ...record,
    version,
    etag,
    bindings,
    ...(auditConfigs ? { auditConfigs } : {}),
  } as GcloudIamPolicy;
}

function parseIamBinding(value: unknown): GcloudIamBinding {
  const record = requireJsonRecord(value);
  const condition = record.condition === undefined
    ? undefined
    : parseIamCondition(record.condition);
  return {
    ...record,
    role: requireString(record.role),
    members: requireStringArray(record.members),
    ...(condition ? { condition } : {}),
  } as GcloudIamBinding;
}

function parseIamCondition(value: unknown): GcloudIamCondition {
  const record = requireJsonRecord(value);
  const description = record.description === undefined
    ? undefined
    : requireString(record.description);
  return {
    ...record,
    title: requireString(record.title),
    expression: requireString(record.expression),
    ...(description !== undefined ? { description } : {}),
  } as GcloudIamCondition;
}

function parseAuditConfig(value: unknown): GcloudAuditConfig {
  const record = requireJsonRecord(value);
  return {
    ...record,
    service: requireString(record.service),
    auditLogConfigs: requireArray(record.auditLogConfigs).map(parseAuditLogConfig),
  } as GcloudAuditConfig;
}

function parseAuditLogConfig(value: unknown): GcloudAuditLogConfig {
  const record = requireJsonRecord(value);
  const exemptedMembers = record.exemptedMembers === undefined
    ? undefined
    : requireStringArray(record.exemptedMembers);
  return {
    ...record,
    logType: requireString(record.logType),
    ...(exemptedMembers ? { exemptedMembers } : {}),
  } as GcloudAuditLogConfig;
}

function parseProjectAncestor(value: unknown): GcloudProjectAncestor {
  const record = requireRecord(value);
  const type = requireString(record.type);
  if (type !== "project" && type !== "folder" && type !== "organization") {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  const id = type === "project"
    ? requireProjectId(requireString(record.id))
    : requireNumericId(record.id);
  return { type, id };
}

function requireJsonRecord(value: unknown): { [key: string]: GcloudJsonValue } {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  return value as { [key: string]: GcloudJsonValue };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  return value;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  return value;
}

function optionalString(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.includes("\0")) {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  return value;
}

function optionalBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  return value.map(requireString);
}

function requireNumericId(value: unknown): string {
  const normalized = requireString(value);
  if (!/^\d+$/.test(normalized)) {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  return normalized;
}

function requireProjectId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(normalized)) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function requireAccountId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(normalized)) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function requireServiceAccountEmail(value: string, projectId: string): string {
  const normalized = value.trim().toLowerCase();
  const suffix = `@${projectId}.iam.gserviceaccount.com`;
  const accountId = normalized.endsWith(suffix)
    ? normalized.slice(0, -suffix.length)
    : "";
  if (!accountId || requireAccountId(accountId) !== accountId) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function requireOperatorAccount(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized !== value
    || !/^[^\s:@]+@[^\s:@]+$/u.test(normalized)
    || normalized.length > 320
  ) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function assertExpectedMutationProject(projectId: string, expectedProjectId: string): void {
  if (projectId !== expectedProjectId) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
}

function requireRoleId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.]{3,64}$/.test(normalized)) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function requireLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\0\r\n]/.test(normalized)) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function requirePermissions(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  const permissions = values.map((value) => {
    const normalized = value.trim();
    if (!/^[a-z][a-zA-Z0-9_.]+$/.test(normalized)) {
      throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
    }
    return normalized;
  });
  if (new Set(permissions).size !== permissions.length) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return permissions;
}

function requireEtag(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\0\r\n]/.test(normalized)) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return normalized;
}

function requirePolicyVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 3) {
    throw new GcloudInfraError("GCLOUD_INVALID_RESPONSE");
  }
  return Number(value);
}

function requireExpectedPolicyVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 3) {
    throw new GcloudInfraError("GCLOUD_INVALID_INPUT");
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is GcloudJsonValue {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value))
  ) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
