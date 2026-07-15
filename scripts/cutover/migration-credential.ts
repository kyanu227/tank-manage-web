import {
  GoogleAuth,
  type AuthClient,
  type CredentialBody,
} from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const CLOUD_RESOURCE_MANAGER_ROOT = "https://cloudresourcemanager.googleapis.com/v3";
const IAM_REQUEST_TIMEOUT_MS = 30_000;

/** data migration credentialがFirestore document処理に使う権限だけを列挙する。 */
export const DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS = [
  "datastore.databases.get",
  "datastore.databases.getMetadata",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.create",
  "datastore.entities.update",
  "datastore.entities.delete",
] as const;

/** Rules reader credentialがfreeze前のlive Rules照合に使う権限だけを列挙する。 */
export const RULES_READER_REQUIRED_IAM_PERMISSIONS = [
  "firebaserules.releases.get",
  "firebaserules.rulesets.get",
] as const;

export type DataMigrationIamPermission =
  typeof DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS[number];
export type RulesReaderIamPermission =
  typeof RULES_READER_REQUIRED_IAM_PERMISSIONS[number];
export type CutoverAccessTokenProvider = () => Promise<string>;

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

export type ServiceAccountCredentialDependencies = {
  auth?: MigrationGoogleAuth;
  fetch?: typeof fetch;
};

type VerifiedServiceAccountCredential<
  Kind extends "data_migration" | "rules_reader",
  Permission extends string,
> = {
  kind: Kind;
  principal: string;
  projectId: string;
  permissions: readonly Permission[];
  accessTokenProvider: CutoverAccessTokenProvider;
};

export type VerifiedDataMigrationCredential = VerifiedServiceAccountCredential<
  "data_migration",
  DataMigrationIamPermission
>;

export type VerifiedRulesReaderCredential = VerifiedServiceAccountCredential<
  "rules_reader",
  RulesReaderIamPermission
>;

export async function verifyDataMigrationCredential(
  input: {
    expectedDataPrincipal: string;
    expectedProjectId: string;
  },
  dependencies: ServiceAccountCredentialDependencies = {},
): Promise<VerifiedDataMigrationCredential> {
  return verifyServiceAccountCredential({
    expectedPrincipal: input.expectedDataPrincipal,
    expectedProjectId: input.expectedProjectId,
    requiredPermissions: DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
    credentialKind: "data_migration",
    credentialLabel: "data migration credential",
  }, dependencies);
}

export async function verifyRulesReaderCredential(
  input: {
    expectedRulesPrincipal: string;
    expectedProjectId: string;
  },
  dependencies: ServiceAccountCredentialDependencies = {},
): Promise<VerifiedRulesReaderCredential> {
  return verifyServiceAccountCredential({
    expectedPrincipal: input.expectedRulesPrincipal,
    expectedProjectId: input.expectedProjectId,
    requiredPermissions: RULES_READER_REQUIRED_IAM_PERMISSIONS,
    credentialKind: "rules_reader",
    credentialLabel: "Rules reader credential",
  }, dependencies);
}

export function assertDistinctCutoverPrincipals(input: {
  expectedDataPrincipal: string;
  expectedRulesPrincipal: string;
}): {
  expectedDataPrincipal: string;
  expectedRulesPrincipal: string;
} {
  const expectedDataPrincipal = requireServiceAccountPrincipal(input.expectedDataPrincipal);
  const expectedRulesPrincipal = requireServiceAccountPrincipal(input.expectedRulesPrincipal);
  if (expectedDataPrincipal === expectedRulesPrincipal) {
    throw new Error("data migration principalとRules reader principalは分離してください");
  }
  return { expectedDataPrincipal, expectedRulesPrincipal };
}

async function verifyServiceAccountCredential<
  Kind extends "data_migration" | "rules_reader",
  Permission extends string,
>(
  input: {
    expectedPrincipal: string;
    expectedProjectId: string;
    requiredPermissions: readonly Permission[];
    credentialKind: Kind;
    credentialLabel: string;
  },
  dependencies: ServiceAccountCredentialDependencies,
): Promise<VerifiedServiceAccountCredential<Kind, Permission>> {
  const expectedPrincipal = requireServiceAccountPrincipal(input.expectedPrincipal);
  const expectedProjectId = requireProjectId(input.expectedProjectId);
  const auth = dependencies.auth ?? createDefaultGoogleAuth();
  const authClient = await loadAuthClient(auth, input.credentialLabel);
  const actualProjectId = await loadCredentialProjectId(auth, input.credentialLabel);
  if (actualProjectId !== expectedProjectId) {
    throw new Error(`${input.credentialLabel}のproject IDがexpected projectと一致しません`);
  }

  const actualPrincipal = await loadServiceAccountPrincipal(
    auth,
    authClient,
    input.credentialLabel,
  );
  if (actualPrincipal !== expectedPrincipal) {
    throw new Error(
      `${input.credentialLabel}のservice-account principalがexpected principalと一致しません`,
    );
  }

  const accessTokenProvider = createCutoverAccessTokenProvider(
    authClient,
    input.credentialLabel,
  );
  await assertRequiredIamPermissions({
    projectId: expectedProjectId,
    accessTokenProvider,
    fetchImpl: dependencies.fetch ?? fetch,
    requiredPermissions: input.requiredPermissions,
    credentialLabel: input.credentialLabel,
  });

  return {
    kind: input.credentialKind,
    principal: actualPrincipal,
    projectId: actualProjectId,
    permissions: input.requiredPermissions,
    accessTokenProvider,
  };
}

export function createCutoverAccessTokenProvider(
  authClient: Pick<AuthClient, "getAccessToken">,
  credentialLabel: string,
): CutoverAccessTokenProvider {
  return async () => {
    let response: { token?: string | null };
    try {
      response = await authClient.getAccessToken();
    } catch {
      throw new Error(`${credentialLabel}のaccess tokenを取得できません`);
    }
    const token = response.token?.trim();
    if (!token) {
      throw new Error(`${credentialLabel}のaccess tokenを取得できません`);
    }
    return token;
  };
}

async function assertRequiredIamPermissions<Permission extends string>(input: {
  projectId: string;
  accessTokenProvider: CutoverAccessTokenProvider;
  fetchImpl: typeof fetch;
  requiredPermissions: readonly Permission[];
  credentialLabel: string;
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
        body: JSON.stringify({ permissions: input.requiredPermissions }),
        signal: AbortSignal.timeout(IAM_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error(`${input.credentialLabel}のIAM権限を検査できません`);
  }
  if (!response.ok) {
    // Error bodyにはAPI側の詳細が含まれ得るため読み込まない。
    throw new Error(
      `${input.credentialLabel}のIAM権限を検査できません (status=${response.status})`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${input.credentialLabel}のIAM権限検査responseが不正です`);
  }
  const granted = parseGrantedPermissions(
    body,
    input.requiredPermissions,
    input.credentialLabel,
  );
  const missing = input.requiredPermissions.filter((permission) => !granted.has(permission));
  if (missing.length > 0) {
    throw new Error(
      `${input.credentialLabel}に必要なIAM権限が不足しています (${missing.join(", ")})`,
    );
  }
}

function createDefaultGoogleAuth(): MigrationGoogleAuth {
  return new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
}

async function loadAuthClient(
  auth: MigrationGoogleAuth,
  credentialLabel: string,
): Promise<MigrationAuthClient> {
  try {
    return await auth.getClient();
  } catch {
    throw new Error(`${credentialLabel}用Application Default Credentialsを取得できません`);
  }
}

async function loadCredentialProjectId(
  auth: MigrationGoogleAuth,
  credentialLabel: string,
): Promise<string> {
  let projectId: string;
  try {
    projectId = await auth.getProjectId();
  } catch {
    throw new Error(`${credentialLabel}のproject IDを取得できません`);
  }
  try {
    return requireProjectId(projectId);
  } catch {
    throw new Error(`${credentialLabel}のproject IDが不正です`);
  }
}

async function loadServiceAccountPrincipal(
  auth: MigrationGoogleAuth,
  authClient: MigrationAuthClient,
  credentialLabel: string,
): Promise<string> {
  let credentials: CredentialBody;
  try {
    credentials = await auth.getCredentials();
  } catch {
    throw new Error(`${credentialLabel}のservice-account principalを取得できません`);
  }
  const principal = credentials.client_email;
  if (!principal) {
    // authorized_user ADCにはclient_emailがない。cutoverではuser ADCを許可しない。
    throw new Error(`${credentialLabel}はservice-account credentialである必要があります`);
  }

  let normalized: string;
  try {
    normalized = requireServiceAccountPrincipal(principal);
  } catch {
    throw new Error(`${credentialLabel}はservice-account credentialである必要があります`);
  }
  const clientPrincipal = exposedClientPrincipal(authClient, credentialLabel);
  if (clientPrincipal && clientPrincipal !== normalized) {
    throw new Error(
      `${credentialLabel}のAuthClient principalがcredential principalと一致しません`,
    );
  }
  return normalized;
}

function exposedClientPrincipal(
  authClient: MigrationAuthClient,
  credentialLabel: string,
): string | null {
  let candidate: unknown;
  if (typeof authClient.getTargetPrincipal === "function") {
    try {
      candidate = authClient.getTargetPrincipal();
    } catch {
      throw new Error(`${credentialLabel}のAuthClient principalを取得できません`);
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
    throw new Error(`${credentialLabel}のAuthClient principalが不正です`);
  }
}

function parseGrantedPermissions<Permission extends string>(
  body: unknown,
  requiredPermissions: readonly Permission[],
  credentialLabel: string,
): Set<Permission> {
  if (!isObject(body) || !Array.isArray(body.permissions)) {
    throw new Error(`${credentialLabel}のIAM権限検査responseが不正です`);
  }
  const allowed = new Set<string>(requiredPermissions);
  const granted = new Set<Permission>();
  body.permissions.forEach((permission) => {
    if (typeof permission !== "string" || !allowed.has(permission)) {
      throw new Error(`${credentialLabel}のIAM権限検査responseが不正です`);
    }
    granted.add(permission as Permission);
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
