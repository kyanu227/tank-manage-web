import {
  GoogleAuth,
  type AuthClient,
  type CredentialBody,
} from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const CLOUD_RESOURCE_MANAGER_ROOT = "https://cloudresourcemanager.googleapis.com/v3";
const IAM_REQUEST_TIMEOUT_MS = 30_000;

/**
 * cutoverが実際に使うFirestore REST操作とfreeze前Rules照合に限定した権限集合。
 * testIamPermissionsは権限の有無を読み取るだけで、IAM policyを変更しない。
 */
export const MIGRATION_REQUIRED_IAM_PERMISSIONS = [
  "datastore.databases.get",
  "datastore.databases.getMetadata",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.create",
  "datastore.entities.update",
  "datastore.entities.delete",
  "firebaserules.releases.get",
  "firebaserules.rulesets.get",
] as const;

export type MigrationIamPermission = typeof MIGRATION_REQUIRED_IAM_PERMISSIONS[number];
export type MigrationAccessTokenProvider = () => Promise<string>;

type MigrationAuthClient = Pick<AuthClient, "getAccessToken"> & {
  email?: unknown;
  serviceAccountEmail?: unknown;
  getTargetPrincipal?: unknown;
};

type MigrationGoogleAuth = {
  getClient(): Promise<MigrationAuthClient>;
  getProjectId(): Promise<string>;
  getCredentials(): Promise<CredentialBody>;
};

export type MigrationCredentialDependencies = {
  auth?: MigrationGoogleAuth;
  fetch?: typeof fetch;
};

export type VerifiedMigrationCredential = {
  principal: string;
  projectId: string;
  permissions: readonly MigrationIamPermission[];
  accessTokenProvider: MigrationAccessTokenProvider;
};

export async function verifyMigrationCredential(
  input: {
    expectedPrincipal: string;
    expectedProjectId: string;
  },
  dependencies: MigrationCredentialDependencies = {},
): Promise<VerifiedMigrationCredential> {
  const expectedPrincipal = requireServiceAccountPrincipal(input.expectedPrincipal);
  const expectedProjectId = requireProjectId(input.expectedProjectId);
  const auth = dependencies.auth ?? createDefaultGoogleAuth();
  const authClient = await loadAuthClient(auth);
  const actualProjectId = await loadCredentialProjectId(auth);
  if (actualProjectId !== expectedProjectId) {
    throw new Error("migration credentialのproject IDがexpected projectと一致しません");
  }

  const actualPrincipal = await loadServiceAccountPrincipal(auth, authClient);
  if (actualPrincipal !== expectedPrincipal) {
    throw new Error("migration credentialのservice-account principalがexpected principalと一致しません");
  }

  const accessTokenProvider = createMigrationAccessTokenProvider(authClient);
  await assertMigrationIamPermissions({
    projectId: expectedProjectId,
    accessTokenProvider,
    fetchImpl: dependencies.fetch ?? fetch,
  });

  return {
    principal: actualPrincipal,
    projectId: actualProjectId,
    permissions: MIGRATION_REQUIRED_IAM_PERMISSIONS,
    accessTokenProvider,
  };
}

export function createMigrationAccessTokenProvider(
  authClient: Pick<AuthClient, "getAccessToken">,
): MigrationAccessTokenProvider {
  return async () => {
    let response: { token?: string | null };
    try {
      response = await authClient.getAccessToken();
    } catch {
      throw new Error("migration credentialのaccess tokenを取得できません");
    }
    const token = response.token?.trim();
    if (!token) {
      throw new Error("migration credentialのaccess tokenを取得できません");
    }
    return token;
  };
}

async function assertMigrationIamPermissions(input: {
  projectId: string;
  accessTokenProvider: MigrationAccessTokenProvider;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const accessToken = await input.accessTokenProvider();
  let response: Response;
  try {
    response = await input.fetchImpl(
      `${CLOUD_RESOURCE_MANAGER_ROOT}/projects/${encodeURIComponent(input.projectId)}:testIamPermissions`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissions: MIGRATION_REQUIRED_IAM_PERMISSIONS }),
        signal: AbortSignal.timeout(IAM_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error("migration credentialのIAM権限を検査できません");
  }
  if (!response.ok) {
    // Error bodyにはAPI側の詳細が含まれ得るため読み込まない。
    throw new Error(`migration credentialのIAM権限を検査できません (status=${response.status})`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("migration credentialのIAM権限検査responseが不正です");
  }
  const granted = parseGrantedPermissions(body);
  const missing = MIGRATION_REQUIRED_IAM_PERMISSIONS.filter((permission) => !granted.has(permission));
  if (missing.length > 0) {
    throw new Error(`migration credentialに必要なIAM権限が不足しています (${missing.join(", ")})`);
  }
}

function createDefaultGoogleAuth(): MigrationGoogleAuth {
  return new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
}

async function loadAuthClient(auth: MigrationGoogleAuth): Promise<MigrationAuthClient> {
  try {
    return await auth.getClient();
  } catch {
    throw new Error("migration用Application Default Credentialsを取得できません");
  }
}

async function loadCredentialProjectId(auth: MigrationGoogleAuth): Promise<string> {
  let projectId: string;
  try {
    projectId = await auth.getProjectId();
  } catch {
    throw new Error("migration credentialのproject IDを取得できません");
  }
  try {
    return requireProjectId(projectId);
  } catch {
    throw new Error("migration credentialのproject IDが不正です");
  }
}

async function loadServiceAccountPrincipal(
  auth: MigrationGoogleAuth,
  authClient: MigrationAuthClient,
): Promise<string> {
  let credentials: CredentialBody;
  try {
    credentials = await auth.getCredentials();
  } catch {
    throw new Error("migration credentialのservice-account principalを取得できません");
  }
  const principal = credentials.client_email;
  if (!principal) {
    // authorized_user ADCにはclient_emailがない。cutoverではuser ADCを許可しない。
    throw new Error("migration credentialはservice-account credentialである必要があります");
  }

  let normalized: string;
  try {
    normalized = requireServiceAccountPrincipal(principal);
  } catch {
    throw new Error("migration credentialはservice-account credentialである必要があります");
  }
  const clientPrincipal = exposedClientPrincipal(authClient);
  if (clientPrincipal && clientPrincipal !== normalized) {
    throw new Error("migration credentialのAuthClient principalがcredential principalと一致しません");
  }
  return normalized;
}

function exposedClientPrincipal(authClient: MigrationAuthClient): string | null {
  let candidate: unknown;
  if (typeof authClient.getTargetPrincipal === "function") {
    try {
      candidate = authClient.getTargetPrincipal();
    } catch {
      throw new Error("migration credentialのAuthClient principalを取得できません");
    }
  } else if (typeof authClient.email === "string" && authClient.email) {
    candidate = authClient.email;
  } else if (
    typeof authClient.serviceAccountEmail === "string"
    && authClient.serviceAccountEmail
    && authClient.serviceAccountEmail !== "default"
  ) {
    candidate = authClient.serviceAccountEmail;
  } else {
    return null;
  }

  try {
    return requireServiceAccountPrincipal(String(candidate));
  } catch {
    throw new Error("migration credentialのAuthClient principalが不正です");
  }
}

function parseGrantedPermissions(body: unknown): Set<MigrationIamPermission> {
  if (!isObject(body) || !Array.isArray(body.permissions)) {
    throw new Error("migration credentialのIAM権限検査responseが不正です");
  }
  const allowed = new Set<string>(MIGRATION_REQUIRED_IAM_PERMISSIONS);
  const granted = new Set<MigrationIamPermission>();
  body.permissions.forEach((permission) => {
    if (typeof permission !== "string" || !allowed.has(permission)) {
      throw new Error("migration credentialのIAM権限検査responseが不正です");
    }
    granted.add(permission as MigrationIamPermission);
  });
  return granted;
}

function requireServiceAccountPrincipal(value: string): string {
  const normalized = value.trim();
  if (
    normalized !== normalized.toLowerCase()
    || !/^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9.-]+\.gserviceaccount\.com$/.test(normalized)
  ) {
    throw new Error("expected principalに正しいservice-account emailを指定してください");
  }
  return normalized;
}

function requireProjectId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(normalized)) {
    throw new Error("expected project IDが不正です");
  }
  return normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
