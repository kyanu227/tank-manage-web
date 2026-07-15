import { describe, expect, it, vi } from "vitest";
import {
  DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
  RULES_READER_REQUIRED_IAM_PERMISSIONS,
  assertDistinctCutoverPrincipals,
  createCutoverAccessTokenProvider,
  verifyDataMigrationCredential,
  verifyRulesReaderCredential,
  type ServiceAccountCredentialDependencies,
} from "./migration-credential";

const PROJECT_ID = "okmarine-tankrental";
const DATA_PRINCIPAL = "tank-cutover-data@okmarine-tankrental.iam.gserviceaccount.com";
const RULES_PRINCIPAL = "tank-cutover-rules@okmarine-tankrental.iam.gserviceaccount.com";
const OTHER_PRINCIPAL = "other@okmarine-tankrental.iam.gserviceaccount.com";
const TOKEN = "unit-test-secret-access-token";

type VerifiedCredentialForTest = {
  kind: "data_migration" | "rules_reader";
  principal: string;
  projectId: string;
  permissions: readonly string[];
  accessTokenProvider: () => Promise<string>;
};

type CredentialCase = {
  label: string;
  principal: string;
  verify: (
    dependencies: ServiceAccountCredentialDependencies,
  ) => Promise<VerifiedCredentialForTest>;
};

const CREDENTIAL_CASES: CredentialCase[] = [
  {
    label: "data migration credential",
    principal: DATA_PRINCIPAL,
    verify: (dependencies) => verifyDataMigrationCredential({
      expectedDataPrincipal: DATA_PRINCIPAL,
      expectedProjectId: PROJECT_ID,
    }, dependencies),
  },
  {
    label: "Rules reader credential",
    principal: RULES_PRINCIPAL,
    verify: (dependencies) => verifyRulesReaderCredential({
      expectedRulesPrincipal: RULES_PRINCIPAL,
      expectedProjectId: PROJECT_ID,
    }, dependencies),
  },
];

describe("data migration credential verification", () => {
  it("Firestore用7権限だけを要求し、kind・count・token providerを返す", async () => {
    const client = authClient(DATA_PRINCIPAL);
    const auth = googleAuth(client, { principal: DATA_PRINCIPAL });
    const fetchMock = exactIamFetch(DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS);

    const result = await verifyDataMigrationCredential(
      {
        expectedDataPrincipal: DATA_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      { auth, fetch: fetchMock },
    );

    expect(auth.getClient).toHaveBeenCalledTimes(1);
    expect(auth.getProjectId).toHaveBeenCalledTimes(1);
    expect(auth.getCredentials).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "data_migration",
      principal: DATA_PRINCIPAL,
      projectId: PROJECT_ID,
    });
    expect(result.permissions).toEqual(DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS);
    expect(result.permissions).toHaveLength(7);
    expect(result.permissions).not.toContain("firebaserules.releases.get");
    expect(result.permissions).not.toContain("firebaserules.rulesets.get");
    await expect(result.accessTokenProvider()).resolves.toBe(TOKEN);
    expect(client.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("Rules権限が付与されていなくてもFirestore用7権限だけで成功する", async () => {
    const result = await verifyDataMigrationCredential(
      {
        expectedDataPrincipal: DATA_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      {
        auth: googleAuth(authClient(DATA_PRINCIPAL), { principal: DATA_PRINCIPAL }),
        fetch: async () => jsonResponse({
          permissions: DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
        }),
      },
    );

    expect(result.permissions).toEqual(DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS);
  });

  it.each(DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS)(
    "必須Data権限 %s が欠落するとfail closedする",
    async (missingPermission) => {
      const granted = DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS.filter(
        (permission) => permission !== missingPermission,
      );

      await expect(verifyDataMigrationCredential(
        {
          expectedDataPrincipal: DATA_PRINCIPAL,
          expectedProjectId: PROJECT_ID,
        },
        {
          auth: googleAuth(authClient(DATA_PRINCIPAL), { principal: DATA_PRINCIPAL }),
          fetch: async () => jsonResponse({ permissions: granted }),
        },
      )).rejects.toThrow(missingPermission);
    },
  );
});

describe("Rules reader credential verification", () => {
  it("Rules読取用2権限だけを要求し、kind・count・token providerを返す", async () => {
    const client = authClient(RULES_PRINCIPAL);
    const auth = googleAuth(client, { principal: RULES_PRINCIPAL });
    const fetchMock = exactIamFetch(RULES_READER_REQUIRED_IAM_PERMISSIONS);

    const result = await verifyRulesReaderCredential(
      {
        expectedRulesPrincipal: RULES_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      { auth, fetch: fetchMock },
    );

    expect(auth.getClient).toHaveBeenCalledTimes(1);
    expect(auth.getProjectId).toHaveBeenCalledTimes(1);
    expect(auth.getCredentials).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "rules_reader",
      principal: RULES_PRINCIPAL,
      projectId: PROJECT_ID,
    });
    expect(result.permissions).toEqual(RULES_READER_REQUIRED_IAM_PERMISSIONS);
    expect(result.permissions).toHaveLength(2);
    DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS.forEach((permission) => {
      expect(result.permissions).not.toContain(permission);
    });
    await expect(result.accessTokenProvider()).resolves.toBe(TOKEN);
    expect(client.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("Firestore権限が付与されていなくてもRules読取用2権限だけで成功する", async () => {
    const result = await verifyRulesReaderCredential(
      {
        expectedRulesPrincipal: RULES_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      {
        auth: googleAuth(authClient(RULES_PRINCIPAL), { principal: RULES_PRINCIPAL }),
        fetch: async () => jsonResponse({
          permissions: RULES_READER_REQUIRED_IAM_PERMISSIONS,
        }),
      },
    );

    expect(result.permissions).toEqual(RULES_READER_REQUIRED_IAM_PERMISSIONS);
  });

  it.each(RULES_READER_REQUIRED_IAM_PERMISSIONS)(
    "必須Rules権限 %s が欠落するとfail closedする",
    async (missingPermission) => {
      const granted = RULES_READER_REQUIRED_IAM_PERMISSIONS.filter(
        (permission) => permission !== missingPermission,
      );

      await expect(verifyRulesReaderCredential(
        {
          expectedRulesPrincipal: RULES_PRINCIPAL,
          expectedProjectId: PROJECT_ID,
        },
        {
          auth: googleAuth(authClient(RULES_PRINCIPAL), { principal: RULES_PRINCIPAL }),
          fetch: async () => jsonResponse({ permissions: granted }),
        },
      )).rejects.toThrow(missingPermission);
    },
  );
});

describe.each(CREDENTIAL_CASES)("$label common verification", (credentialCase) => {
  it("service-account principalの不一致をfail closedする", async () => {
    const fetchMock = vi.fn();
    const client = authClient(OTHER_PRINCIPAL);

    await expect(credentialCase.verify({
      auth: googleAuth(client, { principal: OTHER_PRINCIPAL }),
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow("expected principalと一致しません");
    expect(client.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("credential projectの不一致をIAM request前にfail closedする", async () => {
    const fetchMock = vi.fn();
    const client = authClient(credentialCase.principal);

    await expect(credentialCase.verify({
      auth: googleAuth(client, {
        principal: credentialCase.principal,
        projectId: "other-tank-project",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow("project IDがexpected projectと一致しません");
    expect(client.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("user ADCはclient_emailを持たないためfail closedする", async () => {
    const fetchMock = vi.fn();
    const client = authClient(credentialCase.principal);

    await expect(credentialCase.verify({
      auth: googleAuth(client, { credentials: {} }),
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow("service-account credential");
    expect(client.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AuthClientとcredentialが異なるprincipalを示す場合を拒否する", async () => {
    const fetchMock = vi.fn();
    const client = authClient(OTHER_PRINCIPAL);

    await expect(credentialCase.verify({
      auth: googleAuth(client, { principal: credentialCase.principal }),
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow("AuthClient principal");
    expect(client.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("IAM responseのunknown permissionを拒否する", async () => {
    const requiredPermissions = credentialCase.label.startsWith("data")
      ? DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS
      : RULES_READER_REQUIRED_IAM_PERMISSIONS;

    await expect(credentialCase.verify({
      auth: googleAuth(authClient(credentialCase.principal), {
        principal: credentialCase.principal,
      }),
      fetch: async () => jsonResponse({
        permissions: [
          ...requiredPermissions,
          "resourcemanager.projects.setIamPolicy",
        ],
      }),
    })).rejects.toThrow("responseが不正");
  });
});

describe("credential error safety", () => {
  it("ADC取得失敗からcredential pathやtokenを露出しない", async () => {
    const secretPath = "/secret/credentials/cutover.json";
    const auth = googleAuth(authClient(DATA_PRINCIPAL), {
      principal: DATA_PRINCIPAL,
      getClientError: new Error(`credential-file=${secretPath} token=${TOKEN}`),
    });

    const error = await capturedError(() => verifyDataMigrationCredential(
      {
        expectedDataPrincipal: DATA_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      { auth, fetch: vi.fn() as unknown as typeof fetch },
    ));
    expect(error.message).toContain("Application Default Credentials");
    expect(error.message).not.toContain(secretPath);
    expect(error.message).not.toContain(TOKEN);
  });

  it("access token取得失敗からtokenやcredential pathを露出しない", async () => {
    const secretPath = "/secret/credentials/cutover.json";
    const provider = createCutoverAccessTokenProvider({
      getAccessToken: vi.fn(async () => {
        throw new Error(`upstream leaked ${TOKEN} at ${secretPath}`);
      }),
    }, "data migration credential");

    const error = await capturedError(provider);
    expect(error.message).toBe("data migration credentialのaccess tokenを取得できません");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(secretPath);
  });

  it("IAM HTTP errorからtoken・response body・Rules source・pathを露出しない", async () => {
    const secretPath = "/secret/credentials/cutover.json";
    const secretBody = `private diagnostic ${TOKEN} ${secretPath} service cloud.firestore {}`;
    const error = await capturedError(() => verifyRulesReaderCredential(
      {
        expectedRulesPrincipal: RULES_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      {
        auth: googleAuth(authClient(RULES_PRINCIPAL), { principal: RULES_PRINCIPAL }),
        fetch: async () => new Response(secretBody, { status: 403 }),
      },
    ));

    expect(error.message).toContain("status=403");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(secretBody);
    expect(error.message).not.toContain(secretPath);
    expect(error.message).not.toContain("cloud.firestore");
  });

  it("IAM network errorからtokenやcredential pathを露出しない", async () => {
    const secretPath = "/secret/credentials/cutover.json";
    const error = await capturedError(() => verifyDataMigrationCredential(
      {
        expectedDataPrincipal: DATA_PRINCIPAL,
        expectedProjectId: PROJECT_ID,
      },
      {
        auth: googleAuth(authClient(DATA_PRINCIPAL), { principal: DATA_PRINCIPAL }),
        fetch: async () => {
          throw new Error(`request failed with ${TOKEN} at ${secretPath}`);
        },
      },
    ));

    expect(error.message).toContain("IAM権限を検査できません");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(secretPath);
  });
});

describe("cutover principal separation", () => {
  it("異なるdata・Rules principalを受理する", () => {
    expect(assertDistinctCutoverPrincipals({
      expectedDataPrincipal: DATA_PRINCIPAL,
      expectedRulesPrincipal: RULES_PRINCIPAL,
    })).toEqual({
      expectedDataPrincipal: DATA_PRINCIPAL,
      expectedRulesPrincipal: RULES_PRINCIPAL,
    });
  });

  it("同一principalをfail closedする", () => {
    expect(() => assertDistinctCutoverPrincipals({
      expectedDataPrincipal: DATA_PRINCIPAL,
      expectedRulesPrincipal: DATA_PRINCIPAL,
    })).toThrow("principalは分離してください");
  });
});

function authClient(principal: string, overrides: Record<string, unknown> = {}) {
  return {
    getAccessToken: vi.fn(async () => ({ token: TOKEN })),
    email: principal,
    ...overrides,
  };
}

function googleAuth(
  client: ReturnType<typeof authClient>,
  overrides: {
    principal?: string;
    projectId?: string;
    credentials?: { client_email?: string };
    getClientError?: Error;
  } = {},
): NonNullable<ServiceAccountCredentialDependencies["auth"]> & {
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
    getCredentials: vi.fn(async () => overrides.credentials ?? {
      client_email: overrides.principal ?? DATA_PRINCIPAL,
    }),
  };
}

function exactIamFetch(expectedPermissions: readonly string[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(
      `https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT_ID}:testIamPermissions`,
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({ permissions: expectedPermissions });
    return jsonResponse({ permissions: expectedPermissions });
  });
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
