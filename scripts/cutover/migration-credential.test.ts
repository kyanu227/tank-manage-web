import { describe, expect, it, vi } from "vitest";
import {
  MIGRATION_REQUIRED_IAM_PERMISSIONS,
  createMigrationAccessTokenProvider,
  verifyMigrationCredential,
  type MigrationCredentialDependencies,
} from "./migration-credential";

const PROJECT_ID = "okmarine-tankrental";
const PRINCIPAL = "tank-cutover@okmarine-tankrental.iam.gserviceaccount.com";
const TOKEN = "unit-test-secret-access-token";

describe("migration credential verification", () => {
  it("同一GoogleAuth/AuthClientのservice account・project・9権限を検証する", async () => {
    const client = authClient();
    const auth = googleAuth(client);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT_ID}:testIamPermissions`,
      );
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(String(init?.body))).toEqual({
        permissions: MIGRATION_REQUIRED_IAM_PERMISSIONS,
      });
      return jsonResponse({ permissions: MIGRATION_REQUIRED_IAM_PERMISSIONS });
    });

    const result = await verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      { auth, fetch: fetchMock },
    );

    expect(auth.getClient).toHaveBeenCalledTimes(1);
    expect(auth.getProjectId).toHaveBeenCalledTimes(1);
    expect(auth.getCredentials).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.principal).toBe(PRINCIPAL);
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.permissions).toEqual(MIGRATION_REQUIRED_IAM_PERMISSIONS);
    await expect(result.accessTokenProvider()).resolves.toBe(TOKEN);
    expect(client.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("user ADCはclient_emailを持たないためfail closedする", async () => {
    const client = authClient();
    const auth = googleAuth(client, { credentials: {} });
    const fetchMock = vi.fn();

    await expect(verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      { auth, fetch: fetchMock as unknown as typeof fetch },
    )).rejects.toThrow("service-account credential");
    expect(client.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ADCを取得できない場合は原因詳細を露出せずfail closedする", async () => {
    const auth = googleAuth(authClient(), {
      getClientError: new Error("credential-file=/secret/path key=private-material"),
    });

    const error = await capturedError(() => verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      { auth, fetch: vi.fn() as unknown as typeof fetch },
    ));
    expect(error.message).toContain("Application Default Credentials");
    expect(error.message).not.toContain("/secret/path");
    expect(error.message).not.toContain("private-material");
  });

  it("service-account principalの不一致をfail closedする", async () => {
    const otherPrincipal = "other@okmarine-tankrental.iam.gserviceaccount.com";
    const auth = googleAuth(authClient({ email: otherPrincipal }), {
      credentials: { client_email: otherPrincipal },
    });
    await expect(verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      { auth, fetch: vi.fn() as unknown as typeof fetch },
    )).rejects.toThrow("expected principalと一致しません");
  });

  it("credential projectの不一致をIAM request前にfail closedする", async () => {
    const client = authClient();
    const auth = googleAuth(client, { projectId: "other-tank-project" });
    const fetchMock = vi.fn();
    await expect(verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      { auth, fetch: fetchMock as unknown as typeof fetch },
    )).rejects.toThrow("project IDがexpected projectと一致しません");
    expect(client.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AuthClientとcredentialが異なprincipalを示す場合を拒否する", async () => {
    const client = authClient({
      email: "other@okmarine-tankrental.iam.gserviceaccount.com",
    });
    await expect(verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      { auth: googleAuth(client), fetch: vi.fn() as unknown as typeof fetch },
    )).rejects.toThrow("AuthClient principal");
  });

  it("9権限の1つでも欠落すればfail closedする", async () => {
    const granted = MIGRATION_REQUIRED_IAM_PERMISSIONS.slice(0, -1);
    await expect(verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      {
        auth: googleAuth(authClient()),
        fetch: async () => jsonResponse({ permissions: granted }),
      },
    )).rejects.toThrow("firebaserules.rulesets.get");
  });

  it("IAM API errorのtokenとresponse bodyを例外に含めない", async () => {
    const secretBody = "private diagnostic and document contents";
    const error = await capturedError(() => verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      {
        auth: googleAuth(authClient()),
        fetch: async () => new Response(secretBody, { status: 403 }),
      },
    ));
    expect(error.message).toContain("status=403");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(secretBody);
  });

  it("access token取得失敗の詳細とtokenを例外に含めない", async () => {
    const provider = createMigrationAccessTokenProvider({
      getAccessToken: vi.fn(async () => {
        throw new Error(`upstream leaked ${TOKEN}`);
      }),
    });
    const error = await capturedError(provider);
    expect(error.message).toBe("migration credentialのaccess tokenを取得できません");
    expect(error.message).not.toContain(TOKEN);
  });

  it("IAM responseのunknown permissionや不正shapeを拒否する", async () => {
    await expect(verifyMigrationCredential(
      { expectedPrincipal: PRINCIPAL, expectedProjectId: PROJECT_ID },
      {
        auth: googleAuth(authClient()),
        fetch: async () => jsonResponse({ permissions: [
          ...MIGRATION_REQUIRED_IAM_PERMISSIONS,
          "resourcemanager.projects.setIamPolicy",
        ] }),
      },
    )).rejects.toThrow("responseが不正");
  });
});

function authClient(overrides: Record<string, unknown> = {}) {
  return {
    getAccessToken: vi.fn(async () => ({ token: TOKEN })),
    email: PRINCIPAL,
    ...overrides,
  };
}

function googleAuth(
  client: ReturnType<typeof authClient>,
  overrides: {
    projectId?: string;
    credentials?: { client_email?: string };
    getClientError?: Error;
  } = {},
): NonNullable<MigrationCredentialDependencies["auth"]> & {
  getClient: ReturnType<typeof vi.fn>;
  getProjectId: ReturnType<typeof vi.fn>;
  getCredentials: ReturnType<typeof vi.fn>;
} {
  return {
    getClient: vi.fn(async () => {
      if (overrides.getClientError) throw overrides.getClientError;
      return client;
    }),
    getProjectId: vi.fn(async () => overrides.projectId ?? PROJECT_ID),
    getCredentials: vi.fn(async () => overrides.credentials ?? { client_email: PRINCIPAL }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function capturedError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected action to reject");
}
