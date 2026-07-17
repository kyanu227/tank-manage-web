import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGcloudInfraMutationAdapter,
  createGcloudInfraReadAdapter,
  GcloudInfraError,
  type GcloudIamPolicy,
  type GcloudInfraProcessRequest,
  type GcloudInfraProcessRunner,
} from "./gcloud-infra-adapter";

const PROJECT_ID = "example-project";
const PROJECT_NUMBER = "123456789012";
const DATA_EMAIL = `tank-cutover-data@${PROJECT_ID}.iam.gserviceaccount.com`;
const RULES_EMAIL = `tank-cutover-rules@${PROJECT_ID}.iam.gserviceaccount.com`;
const ROLE_ID = "transitionCutoverData";
const TOKEN = "sensitive-token-value-must-not-leak";
const SECRET_PATH = "/Users/example/private/credential.json";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("gcloud cutover infrastructure read adapter", () => {
  it("typed readだけを実行し、SA・roleの不存在をstderrなしで判定する", async () => {
    const calls: GcloudInfraProcessRequest[] = [];
    const runner: GcloudInfraProcessRunner = vi.fn(async (request) => {
      calls.push(request);
      if (
        request.operation === "get_active_account"
        || request.operation === "get_active_configuration"
      ) {
        return { stdout: JSON.stringify(responseFor(request)) };
      }
      if (
        request.operation === "describe_service_account"
        && request.args.includes(`missing-sa@${PROJECT_ID}.iam.gserviceaccount.com`)
      ) throw new GcloudInfraError("GCLOUD_COMMAND_FAILED");
      if (
        request.operation === "describe_custom_role"
        && request.args.includes("MissingRole")
      ) throw new GcloudInfraError("GCLOUD_COMMAND_FAILED");
      return { stdout: JSON.stringify(responseFor(request)) };
    });
    const adapter = createGcloudInfraReadAdapter({ runner });

    await expect(adapter.getActiveConfiguration()).resolves.toEqual({
      account: "cutover-operator@example.com",
      projectId: PROJECT_ID,
    });
    await expect(adapter.describeProject(PROJECT_ID)).resolves.toEqual({
      projectId: PROJECT_ID,
      projectNumber: PROJECT_NUMBER,
      lifecycleState: "ACTIVE",
      parent: { type: "organization", id: "987654321098" },
    });
    await expect(adapter.describeServiceAccount(PROJECT_ID, DATA_EMAIL)).resolves.toEqual({
      status: "found",
      value: {
        email: DATA_EMAIL,
        uniqueId: "111222333444",
        displayName: "Cutover data",
        description: "Temporary data migration",
        disabled: false,
      },
    });
    await expect(adapter.describeServiceAccount(
      PROJECT_ID,
      `missing-sa@${PROJECT_ID}.iam.gserviceaccount.com`,
    )).resolves.toEqual({ status: "not_found" });
    await expect(adapter.describeCustomRole(PROJECT_ID, ROLE_ID)).resolves.toEqual({
      status: "found",
      value: {
        name: `projects/${PROJECT_ID}/roles/${ROLE_ID}`,
        title: "Transition data",
        description: "Seven permissions",
        includedPermissions: ["datastore.entities.get"],
        stage: "GA",
        deleted: false,
      },
    });
    await expect(adapter.describeCustomRole(PROJECT_ID, "MissingRole"))
      .resolves.toEqual({ status: "not_found" });
    await expect(adapter.getProjectIamPolicy(PROJECT_ID)).resolves.toMatchObject({
      version: 3,
      etag: "BwExample=",
    });
    await expect(adapter.listProjectAncestors(PROJECT_ID)).resolves.toEqual([
      { type: "project", id: PROJECT_ID },
      { type: "folder", id: "24680" },
      { type: "organization", id: "987654321098" },
    ]);
    await expect(adapter.getAncestorIamPolicy({ type: "folder", id: "24680" }))
      .resolves.toMatchObject({ etag: "BwExample=" });
    await expect(adapter.getAncestorIamPolicy({
      type: "organization",
      id: "987654321098",
    })).resolves.toMatchObject({ etag: "BwExample=" });
    await expect(adapter.getServiceAccountIamPolicy(PROJECT_ID, DATA_EMAIL))
      .resolves.toMatchObject({ etag: "BwExample=" });
    await expect(adapter.inspectUserManagedKeys(PROJECT_ID, DATA_EMAIL)).resolves.toEqual({
      totalCount: 3,
      activeCount: 1,
      unverifiableCount: 1,
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.mode === "read")).toBe(true);
    expect(calls.some((call) => call.operation === "list_service_account_fallback")).toBe(true);
    expect(calls.some((call) => call.operation === "list_custom_role_fallback")).toBe(true);
    expect(calls.some((call) => call.mode === "mutation")).toBe(false);
  });

  it("gcloud不在と任意stderrを固定codeへ変換し、path・tokenを公開しない", async () => {
    const missing = createGcloudInfraReadAdapter({
      runner: async () => {
        throw Object.assign(new Error(`${TOKEN} ${SECRET_PATH}`), {
          code: "ENOENT",
          path: SECRET_PATH,
        });
      },
    });
    const missingError = await capturedError(() => missing.describeProject(PROJECT_ID));
    expect(missingError).toMatchObject({ code: "GCLOUD_NOT_FOUND" });
    expect(missingError.message).not.toContain(TOKEN);
    expect(missingError.message).not.toContain(SECRET_PATH);

    const failed = createGcloudInfraReadAdapter({
      runner: async () => {
        throw new Error(`permission denied: ${TOKEN} ${SECRET_PATH}`);
      },
    });
    const failedError = await capturedError(() => failed.describeProject(PROJECT_ID));
    expect(failedError).toMatchObject({ code: "GCLOUD_COMMAND_FAILED" });
    expect(failedError.message).not.toContain(TOKEN);
    expect(failedError.message).not.toContain(SECRET_PATH);
  });

  it("active accountが厳密に1件でない場合をambient fallbackとして拒否する", async () => {
    const adapter = createGcloudInfraReadAdapter({
      runner: async (request) => ({
        stdout: request.operation === "get_active_account"
          ? JSON.stringify([{ account: "one@example.com" }, { account: "two@example.com" }])
          : JSON.stringify({ core: { project: PROJECT_ID } }),
      }),
    });
    await expect(adapter.getActiveConfiguration()).rejects.toMatchObject({
      code: "GCLOUD_RESOURCE_AMBIGUOUS",
    });
  });

  it("environmentとgcloud configのcredential・impersonation overrideを拒否する", async () => {
    for (const environment of [
      { CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: DATA_EMAIL },
      { CLOUDSDK_CONFIG: "/tmp/alternate-gcloud-config" },
      { CLOUDSDK_ACTIVE_CONFIG_NAME: "alternate" },
      { GOOGLE_APPLICATION_CREDENTIALS: SECRET_PATH },
      { GOOGLE_IMPERSONATE_SERVICE_ACCOUNT: DATA_EMAIL },
    ]) {
      const environmentRunner = vi.fn(async () => ({ stdout: "{}" }));
      const environmentOverride = createGcloudInfraReadAdapter({
        runner: environmentRunner,
        environment,
      });
      await expect(environmentOverride.getActiveConfiguration()).rejects.toMatchObject({
        code: "GCLOUD_CREDENTIAL_OVERRIDE_PRESENT",
      });
      expect(environmentRunner).not.toHaveBeenCalled();
    }

    const configOverride = createGcloudInfraReadAdapter({
      environment: {},
      runner: async (request) => ({
        stdout: request.operation === "get_active_account"
          ? JSON.stringify([{ account: "cutover-operator@example.com" }])
          : JSON.stringify({
            auth: { credential_file_override: SECRET_PATH },
            core: { account: "cutover-operator@example.com", project: PROJECT_ID },
          }),
      }),
    });
    const error = await capturedError(() => configOverride.getActiveConfiguration());
    expect(error).toMatchObject({ code: "GCLOUD_CREDENTIAL_OVERRIDE_PRESENT" });
    expect(error.message).not.toContain(SECRET_PATH);
  });
});

describe("gcloud cutover infrastructure mutation adapter", () => {
  it("公開mutationをcreate 2種とpolicy set 2種へ限定し、policyを0600で一度だけ渡す", async () => {
    const root = await temporaryRoot();
    const calls: GcloudInfraProcessRequest[] = [];
    const observedModes: number[] = [];
    const observedPolicies: unknown[] = [];
    const runner: GcloudInfraProcessRunner = vi.fn(async (request) => {
      calls.push(request);
      if (
        request.operation === "get_active_account"
        || request.operation === "get_active_configuration"
      ) {
        return { stdout: JSON.stringify(responseFor(request)) };
      }
      if (
        request.operation === "set_project_iam_policy"
        || request.operation === "set_service_account_iam_policy"
      ) {
        const policyPath = request.args.find((argument: string) => argument.endsWith(".json"));
        expect(policyPath).toBeTruthy();
        const metadata = await stat(policyPath!);
        observedModes.push(metadata.mode & 0o777);
        observedPolicies.push(JSON.parse(await readFile(policyPath!, "utf8")));
      }
      return { stdout: "{}" };
    });
    const adapter = createGcloudInfraMutationAdapter({
      runner,
      temporaryDirectoryRoot: root,
      environment: {},
      expectedOperatorAccount: "cutover-operator@example.com",
      expectedProjectId: PROJECT_ID,
    });
    expect(Object.keys(adapter).sort()).toEqual([
      "createCustomRole",
      "createServiceAccount",
      "setProjectIamPolicyOnce",
      "setServiceAccountIamPolicyOnce",
    ]);

    await adapter.createServiceAccount({
      projectId: PROJECT_ID,
      accountId: "tank-cutover-data",
      displayName: "Cutover data",
      description: "Temporary data migration",
    });
    await adapter.createCustomRole({
      projectId: PROJECT_ID,
      roleId: ROLE_ID,
      title: "Transition data",
      description: "Seven permissions",
      includedPermissions: ["datastore.entities.get"],
      stage: "GA",
    });
    const policy = policyFixture();
    await adapter.setProjectIamPolicyOnce({
      projectId: PROJECT_ID,
      completePolicy: policy,
      expectedEtag: policy.etag,
      expectedVersion: policy.version,
    });
    await adapter.setServiceAccountIamPolicyOnce({
      projectId: PROJECT_ID,
      serviceAccountEmail: DATA_EMAIL,
      completePolicy: policy,
      expectedEtag: policy.etag,
      expectedVersion: policy.version,
    });
    await adapter.setServiceAccountIamPolicyOnce({
      projectId: PROJECT_ID,
      serviceAccountEmail: RULES_EMAIL,
      completePolicy: policy,
      expectedEtag: policy.etag,
      expectedVersion: policy.version,
    });

    await expect(adapter.setProjectIamPolicyOnce({
      projectId: PROJECT_ID,
      completePolicy: policy,
      expectedEtag: policy.etag,
      expectedVersion: policy.version,
    })).rejects.toMatchObject({ code: "GCLOUD_POLICY_ALREADY_ATTEMPTED" });
    await expect(adapter.setServiceAccountIamPolicyOnce({
      projectId: PROJECT_ID,
      serviceAccountEmail: DATA_EMAIL,
      completePolicy: policy,
      expectedEtag: policy.etag,
      expectedVersion: policy.version,
    })).rejects.toMatchObject({ code: "GCLOUD_POLICY_ALREADY_ATTEMPTED" });

    const mutationCalls = calls.filter((call) => call.mode === "mutation");
    expect(mutationCalls.map((call) => call.operation)).toEqual([
      "create_service_account",
      "create_custom_role",
      "set_project_iam_policy",
      "set_service_account_iam_policy",
      "set_service_account_iam_policy",
    ]);
    expect(calls.filter((call) => call.operation === "get_active_account")).toHaveLength(5);
    expect(calls.filter((call) => call.operation === "get_active_configuration")).toHaveLength(5);
    expect(mutationCalls.every((call) => (
      call.args.includes("--account=cutover-operator@example.com")
    ))).toBe(true);
    const allArgs = mutationCalls.flatMap((call) => call.args).join(" ");
    [
      "keys create",
      "keys delete",
      "roles update",
      "remove-iam-policy-binding",
      "firebase deploy",
      "firestore",
      "auth revoke",
    ].forEach((forbidden) => expect(allArgs).not.toContain(forbidden));
    expect(observedModes).toEqual([0o600, 0o600, 0o600]);
    expect(observedPolicies).toEqual([policy, policy, policy]);
    expect(await readdir(root)).toEqual([]);
  });

  it("policy set失敗時もtempを削除し、stderr・token・pathを公開しない", async () => {
    const root = await temporaryRoot();
    const runner: GcloudInfraProcessRunner = vi.fn(async (request) => {
      if (
        request.operation === "get_active_account"
        || request.operation === "get_active_configuration"
      ) {
        return { stdout: JSON.stringify(responseFor(request)) };
      }
      if (request.operation === "set_project_iam_policy") {
        throw new Error(`stderr ${TOKEN} ${SECRET_PATH}`);
      }
      return { stdout: "{}" };
    });
    const adapter = createGcloudInfraMutationAdapter({
      runner,
      temporaryDirectoryRoot: root,
      environment: {},
      expectedOperatorAccount: "cutover-operator@example.com",
      expectedProjectId: PROJECT_ID,
    });
    const policy = policyFixture();
    const error = await capturedError(() => adapter.setProjectIamPolicyOnce({
      projectId: PROJECT_ID,
      completePolicy: policy,
      expectedEtag: policy.etag,
      expectedVersion: policy.version,
    }));
    expect(error).toMatchObject({ code: "GCLOUD_COMMAND_FAILED" });
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(SECRET_PATH);
    expect(await readdir(root)).toEqual([]);
  });

  it("mutation直前にoperator/projectを再確認し、不一致時はmutationを呼ばない", async () => {
    const calls: GcloudInfraProcessRequest[] = [];
    const runner: GcloudInfraProcessRunner = vi.fn(async (request) => {
      calls.push(request);
      if (request.operation === "get_active_account") {
        return { stdout: JSON.stringify([{ account: "other@example.com" }]) };
      }
      if (request.operation === "get_active_configuration") {
        return { stdout: JSON.stringify({
          core: { account: "other@example.com", project: PROJECT_ID },
        }) };
      }
      throw new Error("mutation must not run");
    });
    const adapter = createGcloudInfraMutationAdapter({
      runner,
      environment: {},
      expectedOperatorAccount: "cutover-operator@example.com",
      expectedProjectId: PROJECT_ID,
    });

    await expect(adapter.createServiceAccount({
      projectId: PROJECT_ID,
      accountId: "tank-cutover-data",
      displayName: "Cutover data",
      description: "Temporary data migration",
    })).rejects.toMatchObject({ code: "GCLOUD_ACTIVE_OPERATOR_MISMATCH" });
    expect(calls.every((call) => call.mode === "read")).toBe(true);
  });
});

function responseFor(request: GcloudInfraProcessRequest): unknown {
  switch (request.operation) {
    case "get_active_account":
      return [{ account: "cutover-operator@example.com" }];
    case "get_active_configuration":
      return { core: { account: "cutover-operator@example.com", project: PROJECT_ID } };
    case "describe_project":
      return {
        projectId: PROJECT_ID,
        projectNumber: PROJECT_NUMBER,
        lifecycleState: "ACTIVE",
        parent: { type: "organization", id: "987654321098" },
      };
    case "describe_service_account":
      return {
        email: DATA_EMAIL,
        uniqueId: "111222333444",
        displayName: "Cutover data",
        description: "Temporary data migration",
      };
    case "list_service_account_fallback":
    case "list_custom_role_fallback":
      return [];
    case "describe_custom_role":
      return {
        name: `projects/${PROJECT_ID}/roles/${ROLE_ID}`,
        title: "Transition data",
        description: "Seven permissions",
        includedPermissions: ["datastore.entities.get"],
        stage: "GA",
      };
    case "get_project_iam_policy":
    case "get_folder_iam_policy":
    case "get_organization_iam_policy":
    case "get_service_account_iam_policy":
      return policyFixture();
    case "list_project_ancestors":
      return [
        { type: "project", id: PROJECT_ID },
        { type: "folder", id: "24680" },
        { type: "organization", id: "987654321098" },
      ];
    case "list_user_managed_keys":
      return [{
        name: "redacted-one",
        validAfterTime: "2020-01-01T00:00:00Z",
        validBeforeTime: "2099-01-01T00:00:00Z",
      }, {
        name: "redacted-disabled",
        disabled: true,
        validAfterTime: "2020-01-01T00:00:00Z",
        validBeforeTime: "2099-01-01T00:00:00Z",
      }, { name: "redacted-two" }];
    default:
      throw new Error("unexpected operation");
  }
}

function policyFixture(): GcloudIamPolicy {
  return {
    version: 3,
    etag: "BwExample=",
    bindings: [{
      role: `projects/${PROJECT_ID}/roles/${ROLE_ID}`,
      members: [`serviceAccount:${DATA_EMAIL}`],
      condition: {
        title: "transition_cutover_data_expires",
        expression: "request.time < timestamp(\"2026-07-18T00:00:00Z\")",
      },
    }],
    auditConfigs: [{
      service: "datastore.googleapis.com",
      auditLogConfigs: [{ logType: "DATA_WRITE" }],
    }],
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gcloud-infra-adapter-test-"));
  temporaryRoots.push(root);
  return root;
}

async function capturedError(action: () => Promise<unknown>): Promise<GcloudInfraError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(GcloudInfraError);
    return error as GcloudInfraError;
  }
  throw new Error("expected action to fail");
}
