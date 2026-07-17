import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCutoverInfrastructure,
  planCutoverInfrastructure,
} from "./cutover-infra-service";
import {
  CUTOVER_INFRA_CONFIRMATION,
  CUTOVER_INFRA_CONTRACT,
  type CutoverInfraApplyArguments,
  type CutoverInfraPlanArguments,
} from "./infra-contract";
import type {
  GcloudCustomRole,
  GcloudIamPolicy,
  GcloudInfraMutationAdapter,
  GcloudInfraReadAdapter,
  GcloudLookup,
  GcloudServiceAccount,
} from "./gcloud-infra-adapter";
import type { LocalCommandRequest } from "./local-cutover-environment";

const temporaryDirectories: string[] = [];
const EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000)
  .toISOString()
  .replace(/\.\d{3}Z$/u, "Z");
const OPERATOR = "user:operator@example.com" as const;
const RULES_DEPLOY = "user:rules-deployer@example.com" as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("cutover infrastructure planner", () => {
  it("完全一致resourceをread-onlyで検査しmutationを呼ばない", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    const mutation = mutationAdapter();
    const report = await planCutoverInfrastructure({ args: planArgs(snapshotDirectory), repositoryRoot }, {
      readAdapter: fixture.read,
      mutationAdapter: mutation,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.actions).toEqual([]);
    expect(report.applyBlockers).toEqual([]);
    expect(report.resources.dataWriteAuditLogs).toBe("exact");
    expect(Object.values(mutation).every((call) => !vi.mocked(call).mock.calls.length)).toBe(true);
  });

  it("roleの不足・過剰permissionと期限なしbindingは停止し、Audit exemptionはwarningにする", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.dataRole = {
      status: "found",
      value: {
        ...expectedDataRole(),
        includedPermissions: [
          ...expectedDataRole().includedPermissions,
          "datastore.indexes.create",
        ],
      },
    };
    fixture.rulesRole = {
      status: "found",
      value: {
        ...expectedRulesRole(),
        includedPermissions: expectedRulesRole().includedPermissions.slice(0, -1),
      },
    };
    fixture.projectPolicy.bindings[0] = {
      role: CUTOVER_INFRA_CONTRACT.roles.data.name,
      members: [`serviceAccount:${CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email}`],
    };
    fixture.projectPolicy.auditConfigs![0].auditLogConfigs[0].exemptedMembers = [
      "user:exempt@example.com",
    ];

    const report = await planCutoverInfrastructure({ args: planArgs(snapshotDirectory), repositoryRoot }, {
      readAdapter: fixture.read,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.applyBlockers).toEqual(expect.arrayContaining([
      "DATA_CUSTOM_ROLE_DRIFT",
      "RULES_CUSTOM_ROLE_DRIFT",
      "DATA_PROJECT_BINDING_DRIFT",
    ]));
    expect(report.warnings).toContain("DATA_WRITE_AUDIT_EXEMPTION_PRESENT");
    expect(report.resources.dataWriteAuditLogs).toBe("exemptions_present");
  });

  it("DATA_WRITE Audit Logsが未設定でもwarningだけでIAM変更を計画しない", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.projectPolicy.auditConfigs = [];
    const mutation = mutationAdapter();

    const report = await planCutoverInfrastructure({
      args: planArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      mutationAdapter: mutation,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.actions).toEqual([]);
    expect(report.applyBlockers).toEqual([]);
    expect(report.resources.dataWriteAuditLogs).toBe("missing");
    expect(report.warnings).toContain("DATA_WRITE_AUDIT_LOGS_NOT_ENABLED");
    expect(vi.mocked(mutation.setProjectIamPolicyOnce)).not.toHaveBeenCalled();
  });

  it("専用custom roleの別principal・groupへの追加bindingを拒否する", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.projectPolicy.bindings.push(
      {
        ...projectBinding("data"),
        members: ["serviceAccount:unexpected@okmarine-tankrental.iam.gserviceaccount.com"],
      },
      {
        ...projectBinding("rules"),
        members: ["group:cutover@example.com"],
      },
    );

    const report = await planCutoverInfrastructure({
      args: planArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.applyBlockers).toEqual(expect.arrayContaining([
      "DATA_PROJECT_BINDING_DRIFT",
      "RULES_PROJECT_BINDING_DRIFT",
    ]));
  });

  it("専用role外でもgroup bindingがあればmembership監査なしにGOとしない", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.projectPolicy.bindings.push({
      role: "roles/viewer",
      members: ["group:operations@example.com"],
    });

    const report = await planCutoverInfrastructure({
      args: planArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.readinessBlockers)
      .toContain("GROUP_BINDINGS_PRESENT_HARD_STOP");
  });

  it("target SAに専用custom role以外のproject roleがあれば拒否する", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.projectPolicy.bindings.push(
      {
        role: "roles/owner",
        members: [`serviceAccount:${CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email}`],
      },
      {
        role: "roles/datastore.user",
        members: [`serviceAccount:${CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email}`],
      },
    );

    const report = await planCutoverInfrastructure({
      args: planArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.applyBlockers).toEqual(expect.arrayContaining([
      "DATA_PROJECT_BINDING_DRIFT",
      "RULES_PROJECT_BINDING_DRIFT",
    ]));
  });

  it("active gcloud account/projectの不一致をapply blockerにする", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.activeConfiguration = { account: "other@example.com", projectId: "other-project" };
    const report = await planCutoverInfrastructure({ args: planArgs(snapshotDirectory), repositoryRoot }, {
      readAdapter: fixture.read,
      local: localDependencies(snapshotDirectory, true),
    });
    expect(report.applyBlockers).toContain("ACTIVE_GCLOUD_CONFIGURATION_MISMATCH");
  });

  it("project・ancestorのtarget SA impersonation surface roleをすべて拒否する", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const roles = [
      "roles/iam.serviceAccountTokenCreator",
      "roles/iam.serviceAccountOpenIdTokenCreator",
      "roles/iam.workloadIdentityUser",
      "roles/iam.serviceAccountUser",
    ];
    for (const [index, role] of roles.entries()) {
      const fixture = exactFixture();
      const policy = index % 2 === 0 ? fixture.projectPolicy : fixture.ancestorPolicy;
      policy.bindings.push({ role, members: ["user:unexpected@example.com"] });
      const report = await planCutoverInfrastructure({
        args: planArgs(snapshotDirectory),
        repositoryRoot,
      }, {
        readAdapter: fixture.read,
        local: localDependencies(snapshotDirectory, true),
      });
      expect(report.applyBlockers).toContain("TARGET_SA_EFFECTIVE_IMPERSONATION_SURFACE");
    }
  });
});

describe("cutover infrastructure apply", () => {
  it("既存resourceが完全一致する場合は外部変更なしで冪等に成功する", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    const mutation = mutationAdapter();

    const report = await applyCutoverInfrastructure({
      args: applyArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      mutationAdapter: mutation,
      local: localDependencies(snapshotDirectory, true),
    });

    expect(report.actions).toEqual([]);
    expect(report.applyBlockers).toEqual([]);
    expect(Object.values(mutation).every((call) => !vi.mocked(call).mock.calls.length)).toBe(true);
  });

  it("missing snapshot directoryだけを0700で作成し、再読取りで完全一致にする", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const missingDirectory = join(snapshotDirectory, "planned");
    const fixture = exactFixture();
    const mutation = mutationAdapter();
    const local = localDependencies(missingDirectory, true);

    const plan = await planCutoverInfrastructure({
      args: planArgs(missingDirectory),
      repositoryRoot,
    }, { readAdapter: fixture.read, mutationAdapter: mutation, local });
    expect(plan.actions).toContain("create_snapshot_directory");
    expect(plan.resources.snapshotDirectory).toBe("missing");

    const applied = await applyCutoverInfrastructure({
      args: applyArgs(missingDirectory),
      repositoryRoot,
    }, { readAdapter: fixture.read, mutationAdapter: mutation, local });
    expect(applied.actions).toEqual([]);
    expect(applied.resources.snapshotDirectory).toBe("local_encrypted");
    expect((await stat(missingDirectory)).mode & 0o777).toBe(0o700);
    expect(Object.values(mutation).every((call) => !vi.mocked(call).mock.calls.length)).toBe(true);
  });

  it("missing resourceだけを作成し、policyを一度ずつ設定してKeychainを最後に作る", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.dataSa = { status: "not_found" };
    fixture.rulesSa = { status: "not_found" };
    fixture.dataRole = { status: "not_found" };
    fixture.rulesRole = { status: "not_found" };
    fixture.projectPolicy = emptyPolicy("project-etag");
    fixture.dataSaPolicy = null;
    fixture.rulesSaPolicy = null;
    const operationOrder: string[] = [];
    const mutation: GcloudInfraMutationAdapter = {
      createServiceAccount: vi.fn(async ({ accountId }) => {
        operationOrder.push(`create-sa:${accountId}`);
        if (accountId === CUTOVER_INFRA_CONTRACT.serviceAccounts.data.id) {
          fixture.dataSa = { status: "found", value: expectedDataSa() };
          fixture.dataSaPolicy = emptyPolicy("data-etag");
        } else {
          fixture.rulesSa = { status: "found", value: expectedRulesSa() };
          fixture.rulesSaPolicy = emptyPolicy("rules-etag");
        }
      }),
      createCustomRole: vi.fn(async ({ roleId }) => {
        operationOrder.push(`create-role:${roleId}`);
        if (roleId === CUTOVER_INFRA_CONTRACT.roles.data.id) {
          fixture.dataRole = { status: "found", value: expectedDataRole() };
        } else {
          fixture.rulesRole = { status: "found", value: expectedRulesRole() };
        }
      }),
      setProjectIamPolicyOnce: vi.fn(async ({ completePolicy }) => {
        operationOrder.push("set-project-policy");
        fixture.projectPolicy = completePolicy;
      }),
      setServiceAccountIamPolicyOnce: vi.fn(async ({ serviceAccountEmail, completePolicy }) => {
        operationOrder.push(`set-sa-policy:${serviceAccountEmail}`);
        if (serviceAccountEmail === CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email) {
          fixture.dataSaPolicy = completePolicy;
        } else {
          fixture.rulesSaPolicy = completePolicy;
        }
      }),
    };
    const local = mutableKeychainLocal(snapshotDirectory, operationOrder);

    const report = await applyCutoverInfrastructure({
      args: applyArgs(snapshotDirectory),
      repositoryRoot,
    }, { readAdapter: fixture.read, mutationAdapter: mutation, local });

    expect(report.actions).toEqual([]);
    expect(report.applyBlockers).toEqual([]);
    expect(operationOrder.at(-1)).toBe("keychain:add");
    expect(vi.mocked(mutation.setProjectIamPolicyOnce)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mutation.setServiceAccountIamPolicyOnce)).toHaveBeenCalledTimes(2);
    expect(fixture.projectPolicy.auditConfigs).toBeUndefined();
  });

  it("作成resourceを再読取できない間はIAM policyへ進まない", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.dataSa = { status: "not_found" };
    fixture.dataSaPolicy = null;
    const mutation = mutationAdapter();

    await expect(applyCutoverInfrastructure({
      args: applyArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      mutationAdapter: mutation,
      local: localDependencies(snapshotDirectory, true),
    })).rejects.toThrow("完全一致");

    expect(vi.mocked(mutation.createServiceAccount)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mutation.setProjectIamPolicyOnce)).not.toHaveBeenCalled();
    expect(vi.mocked(mutation.setServiceAccountIamPolicyOnce)).not.toHaveBeenCalled();
  });

  it("既存driftがあれば最初のmutationより前に停止する", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    fixture.dataSa = {
      status: "found",
      value: { ...expectedDataSa(), disabled: true },
    };
    const mutation = mutationAdapter();
    await expect(applyCutoverInfrastructure({
      args: applyArgs(snapshotDirectory),
      repositoryRoot,
    }, {
      readAdapter: fixture.read,
      mutationAdapter: mutation,
      local: localDependencies(snapshotDirectory, true),
    })).rejects.toThrow("drift");
    expect(Object.values(mutation).every((call) => !vi.mocked(call).mock.calls.length)).toBe(true);
  });

  it("公開service境界でもexecuteとconfirmationを最初に再検証する", async () => {
    const { repositoryRoot, snapshotDirectory } = await temporaryWorkspace();
    const fixture = exactFixture();
    const mutation = mutationAdapter();
    const activeConfigurationRead = vi.spyOn(fixture.read, "getActiveConfiguration");
    const forged = {
      ...applyArgs(snapshotDirectory),
      confirmation: "WRONG",
    } as unknown as CutoverInfraApplyArguments;
    await expect(applyCutoverInfrastructure({ args: forged, repositoryRoot }, {
      readAdapter: fixture.read,
      mutationAdapter: mutation,
      local: localDependencies(snapshotDirectory, true),
    })).rejects.toThrow("authorization");
    expect(activeConfigurationRead).not.toHaveBeenCalled();
    expect(Object.values(mutation).every((call) => !vi.mocked(call).mock.calls.length)).toBe(true);
  });
});

type MutableFixture = {
  activeConfiguration: { account: string; projectId: string };
  dataSa: GcloudLookup<GcloudServiceAccount>;
  rulesSa: GcloudLookup<GcloudServiceAccount>;
  dataRole: GcloudLookup<GcloudCustomRole>;
  rulesRole: GcloudLookup<GcloudCustomRole>;
  projectPolicy: GcloudIamPolicy;
  ancestorPolicy: GcloudIamPolicy;
  dataSaPolicy: GcloudIamPolicy | null;
  rulesSaPolicy: GcloudIamPolicy | null;
  read: GcloudInfraReadAdapter;
};

function exactFixture(): MutableFixture {
  const fixture: Omit<MutableFixture, "read"> & { read?: GcloudInfraReadAdapter } = {
    activeConfiguration: {
      account: "operator@example.com",
      projectId: CUTOVER_INFRA_CONTRACT.projectId,
    },
    dataSa: { status: "found", value: expectedDataSa() } as GcloudLookup<GcloudServiceAccount>,
    rulesSa: { status: "found", value: expectedRulesSa() } as GcloudLookup<GcloudServiceAccount>,
    dataRole: { status: "found", value: expectedDataRole() } as GcloudLookup<GcloudCustomRole>,
    rulesRole: { status: "found", value: expectedRulesRole() } as GcloudLookup<GcloudCustomRole>,
    projectPolicy: exactProjectPolicy(),
    ancestorPolicy: emptyPolicy("ancestor-etag"),
    dataSaPolicy: exactSaPolicy("data"),
    rulesSaPolicy: exactSaPolicy("rules"),
  };
  const read: GcloudInfraReadAdapter = {
    getActiveConfiguration: async () => fixture.activeConfiguration,
    describeProject: async () => ({
      projectId: CUTOVER_INFRA_CONTRACT.projectId,
      projectNumber: "123456789",
      lifecycleState: "ACTIVE",
    }),
    describeServiceAccount: async (_project, email) => (
      email === CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email
        ? fixture.dataSa
        : fixture.rulesSa
    ),
    describeCustomRole: async (_project, roleId) => (
      roleId === CUTOVER_INFRA_CONTRACT.roles.data.id
        ? fixture.dataRole
        : fixture.rulesRole
    ),
    getProjectIamPolicy: async () => fixture.projectPolicy,
    listProjectAncestors: async () => [
      { type: "project" as const, id: CUTOVER_INFRA_CONTRACT.projectId },
      { type: "organization" as const, id: "123" },
    ],
    getAncestorIamPolicy: async () => fixture.ancestorPolicy,
    getServiceAccountIamPolicy: async (_project, email) => {
      const policy = email === CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email
        ? fixture.dataSaPolicy
        : fixture.rulesSaPolicy;
      if (!policy) throw new Error("missing SA policy fixture");
      return policy;
    },
    inspectUserManagedKeys: async () => ({
      totalCount: 0,
      activeCount: 0,
      unverifiableCount: 0,
    }),
  };
  return Object.assign(fixture, { read }) as MutableFixture;
}

function expectedDataSa(): GcloudServiceAccount {
  return {
    email: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
    uniqueId: "1",
    displayName: "Transition cutover data migration",
    description: "Temporary staff-only transition cutover data principal",
    disabled: false,
  };
}

function expectedRulesSa(): GcloudServiceAccount {
  return {
    email: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
    uniqueId: "2",
    displayName: "Transition cutover Rules reader",
    description: "Temporary read-only live Rules baseline principal",
    disabled: false,
  };
}

function expectedDataRole(): GcloudCustomRole {
  return {
    name: CUTOVER_INFRA_CONTRACT.roles.data.name,
    title: "Transition Cutover Data",
    description: "Exact Firestore data permissions for transition cutover",
    includedPermissions: [...CUTOVER_INFRA_CONTRACT.roles.data.permissions],
    stage: "GA",
    deleted: false,
  };
}

function expectedRulesRole(): GcloudCustomRole {
  return {
    name: CUTOVER_INFRA_CONTRACT.roles.rules.name,
    title: "Transition Rules Baseline Read",
    description: "Exact Firebase Rules read permissions for cutover baseline",
    includedPermissions: [...CUTOVER_INFRA_CONTRACT.roles.rules.permissions],
    stage: "GA",
    deleted: false,
  };
}

function exactProjectPolicy(): GcloudIamPolicy {
  return {
    version: 3,
    etag: "project-etag",
    bindings: [
      projectBinding("data"),
      projectBinding("rules"),
    ],
    auditConfigs: [{
      service: "datastore.googleapis.com",
      auditLogConfigs: [{ logType: "DATA_WRITE" }],
    }],
  };
}

function projectBinding(kind: "data" | "rules") {
  const target = kind === "data"
    ? CUTOVER_INFRA_CONTRACT.serviceAccounts.data
    : CUTOVER_INFRA_CONTRACT.serviceAccounts.rules;
  const role = kind === "data"
    ? CUTOVER_INFRA_CONTRACT.roles.data.name
    : CUTOVER_INFRA_CONTRACT.roles.rules.name;
  return {
    role,
    members: [`serviceAccount:${target.email}`],
    condition: condition(kind),
  };
}

function exactSaPolicy(kind: "data" | "rules"): GcloudIamPolicy {
  return {
    version: 3,
    etag: `${kind}-etag`,
    bindings: [{
      role: "roles/iam.serviceAccountTokenCreator",
      members: [OPERATOR],
      condition: condition(`${kind}-impersonation`),
    }],
  };
}

function condition(kind: string) {
  return {
    title: `transition-cutover-${kind}-expiry`,
    description: "Temporary transition cutover access; remove after cutover",
    expression: `request.time < timestamp(\"${EXPIRES_AT}\")`,
  };
}

function emptyPolicy(etag: string): GcloudIamPolicy {
  return { version: 3, etag, bindings: [] };
}

function planArgs(snapshotDirectory: string): CutoverInfraPlanArguments {
  return {
    command: "plan",
    projectId: CUTOVER_INFRA_CONTRACT.projectId,
    expectedOperatorPrincipal: OPERATOR,
    rulesDeployPrincipal: RULES_DEPLOY,
    bindingExpiresAt: EXPIRES_AT,
    keyId: "transition-v1",
    snapshotDirectory,
    snapshotStorageMode: "local_encrypted",
    dataPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email,
    rulesPrincipal: CUTOVER_INFRA_CONTRACT.serviceAccounts.rules.email,
  };
}

function applyArgs(snapshotDirectory: string): CutoverInfraApplyArguments {
  return {
    ...planArgs(snapshotDirectory),
    command: "apply",
    execute: true,
    confirmation: CUTOVER_INFRA_CONFIRMATION,
  };
}

function mutationAdapter(): GcloudInfraMutationAdapter {
  return {
    createServiceAccount: vi.fn(),
    createCustomRole: vi.fn(),
    setProjectIamPolicyOnce: vi.fn(),
    setServiceAccountIamPolicyOnce: vi.fn(),
  };
}

function localDependencies(snapshotDirectory: string, keyExists: boolean) {
  const encodedKey = Buffer.from(Buffer.alloc(32, 7).toString("base64"), "ascii");
  return {
    runCommand: vi.fn(async (request: LocalCommandRequest) => {
      if (request.executable === "/sbin/mount") {
        return {
          exitCode: 0,
          stdout: `/dev/disk1 on / (apfs, local)\n/dev/test on ${snapshotDirectory} (apfs, local)`,
        };
      }
      return {
        exitCode: keyExists ? 0 : 44,
        stdout: keyExists ? Buffer.from(encodedKey) : Buffer.alloc(0),
      };
    }),
  };
}

function mutableKeychainLocal(snapshotDirectory: string, order: string[]) {
  let exists = false;
  let stored = Buffer.alloc(0);
  return {
    randomBytes: () => Buffer.alloc(32, 7),
    prepareKeychainWriteHelper: async () => ({
      executablePath: "/tmp/test-keychain-helper",
      argumentPrefix: ["-N", "-n", "-f", "/tmp/test-keychain-helper.exp"],
      dispose: async () => undefined,
    }),
    runCommand: vi.fn(async (request: LocalCommandRequest) => {
      if (request.executable === "/sbin/mount") {
        return {
          exitCode: 0,
          stdout: `/dev/disk1 on / (apfs, local)\n/dev/test on ${snapshotDirectory} (apfs, local)`,
        };
      }
      if (request.args.includes("add-generic-password")) {
        order.push("keychain:add");
        exists = true;
        stored = Buffer.from(request.stdin ?? Buffer.alloc(0));
        if (stored.at(-1) === 0x0a) stored = stored.subarray(0, stored.byteLength - 1);
        return { exitCode: 0, stdout: "" };
      }
      return {
        exitCode: exists ? 0 : 44,
        stdout: request.args.includes("-w") ? Buffer.from(stored) : "",
      };
    }),
  };
}

async function temporaryWorkspace(): Promise<{
  repositoryRoot: string;
  snapshotDirectory: string;
}> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "cutover-infra-service-")));
  temporaryDirectories.push(path);
  const repositoryRoot = join(path, "repository");
  const snapshotDirectory = join(path, "snapshot");
  await Promise.all([mkdir(repositoryRoot), mkdir(snapshotDirectory, { mode: 0o700 })]);
  return { repositoryRoot, snapshotDirectory };
}
