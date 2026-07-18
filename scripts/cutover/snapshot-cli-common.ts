import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { userInfo } from "node:os";
import { FirestoreRestClient } from "./firestore-rest-client";
import {
  verifyDataMigrationCredential,
  type VerifiedDataMigrationCredential,
} from "./migration-credential";
import type { SnapshotKeySource } from "./snapshot-key-provider";
import type { SnapshotStorageMode } from "./snapshot-envelope";

export type SnapshotCommonArguments = {
  projectId: string;
  databaseId: string;
  databaseUid: string;
  mainCommit: string;
  keyId: string;
  snapshotStorageMode: SnapshotStorageMode;
  expectedDataPrincipal?: string;
  emulatorHost?: string;
  keySource: SnapshotKeySource;
  repositoryRoot: string;
};

export function parseSnapshotCommonArguments(
  argv: readonly string[],
  additionalNames: readonly string[],
): SnapshotCommonArguments {
  const knownNames = new Set([
    "--project",
    "--database",
    "--expected-database-uid",
    "--expected-main-commit",
    "--key-id",
    "--snapshot-storage-mode",
    "--expected-data-principal",
    "--test-key-stdin",
    ...additionalNames,
  ]);
  const seenNames = new Set<string>();
  argv.forEach((argument) => {
    const name = argument.split("=", 1)[0];
    if (!knownNames.has(name)) throw new Error(`未知の引数です: ${name}`);
    if (seenNames.has(name)) throw new Error(`引数を重複指定できません: ${name}`);
    seenNames.add(name);
  });

  const projectId = argumentValue(argv, "--project");
  const databaseId = argumentValue(argv, "--database");
  const databaseUid = argumentValue(argv, "--expected-database-uid");
  const mainCommit = argumentValue(argv, "--expected-main-commit");
  const keyId = argumentValue(argv, "--key-id");
  const snapshotStorageMode = argumentValue(argv, "--snapshot-storage-mode");
  const expectedDataPrincipal = argumentValue(argv, "--expected-data-principal") || undefined;
  if (!projectId) throw new Error("--project=<explicit-project-id> は必須です");
  if (!databaseId) throw new Error("--database=<explicit-database-id> は必須です");
  if (!databaseUid) throw new Error("--expected-database-uid=<uid> は必須です");
  if (!/^[0-9a-f]{40}$/.test(mainCommit)) {
    throw new Error("--expected-main-commitには40文字のGit SHAが必要です");
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(keyId)) {
    throw new Error("--key-idは英数字・._-だけで指定してください");
  }
  if (
    snapshotStorageMode !== "local_encrypted"
    && snapshotStorageMode !== "icloud_encrypted"
  ) {
    throw new Error("--snapshot-storage-modeにはlocal_encryptedまたはicloud_encryptedが必要です");
  }

  const repositoryRoot = gitOutput(["rev-parse", "--show-toplevel"]);
  const actualHead = gitOutput(["rev-parse", "HEAD"]);
  if (actualHead !== mainCommit) {
    throw new Error(`現在のHEAD(${actualHead})とexpected main commit(${mainCommit})が一致しません`);
  }
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim() || undefined;
  if (emulatorHost && !projectId.startsWith("demo-")) {
    throw new Error("Firestore Emulatorではdemo- prefixのproject IDだけを使用できます");
  }
  if (!emulatorHost) {
    if (!expectedDataPrincipal) {
      throw new Error(
        "本番cutoverでは--expected-data-principal=<data-migration-service-account>が必須です",
      );
    }
    assertProductionCredentialHygiene({
      repositoryRoot,
      credentialPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const dirty = gitOutput(["status", "--porcelain"]);
    if (dirty) throw new Error("本番snapshot/restoreはclean worktreeでだけ実行できます");
    const originMain = gitOutput(["rev-parse", "origin/main"]);
    if (originMain !== mainCommit) {
      throw new Error(`origin/main(${originMain})とexpected main commit(${mainCommit})が一致しません`);
    }
  }
  const testKeyStdin = argv.includes("--test-key-stdin");
  if (testKeyStdin && !emulatorHost) {
    throw new Error("--test-key-stdinはFirestore Emulatorでだけ使用できます");
  }

  return {
    projectId,
    databaseId,
    databaseUid,
    mainCommit,
    keyId,
    snapshotStorageMode,
    expectedDataPrincipal,
    emulatorHost,
    keySource: testKeyStdin ? "test-stdin" : "keychain",
    repositoryRoot,
  };
}

export type SnapshotRestRuntime = {
  client: FirestoreRestClient;
  credential: VerifiedDataMigrationCredential | null;
};

export type SnapshotRestRuntimeDependencies = {
  verifyDataCredential?: typeof verifyDataMigrationCredential;
};

export async function createSnapshotRestRuntime(
  args: SnapshotCommonArguments,
  dependencies: SnapshotRestRuntimeDependencies = {},
): Promise<SnapshotRestRuntime> {
  if (args.emulatorHost) {
    return {
      client: new FirestoreRestClient({
        projectId: args.projectId,
        databaseId: args.databaseId,
        emulatorHost: args.emulatorHost,
      }),
      credential: null,
    };
  }
  if (!args.expectedDataPrincipal) {
    throw new Error("本番cutoverのexpected data principalがありません");
  }
  const credential = await (
    dependencies.verifyDataCredential ?? verifyDataMigrationCredential
  )({
    expectedDataPrincipal: args.expectedDataPrincipal,
    expectedProjectId: args.projectId,
  });
  return {
    client: createDataMigrationFirestoreRestClient(args, credential),
    credential,
  };
}

/** Firestore document clientへRules reader credentialが混入するのをruntimeでも拒否する。 */
export function createDataMigrationFirestoreRestClient(
  args: Pick<SnapshotCommonArguments, "projectId" | "databaseId">,
  credential: Pick<
    VerifiedDataMigrationCredential,
    "kind" | "principal" | "accessTokenProvider"
  >,
): FirestoreRestClient {
  if (credential.kind !== "data_migration") {
    throw new Error("Firestore data処理にはdata migration credentialが必要です");
  }
  return new FirestoreRestClient({
    projectId: args.projectId,
    databaseId: args.databaseId,
    accessTokenProvider: credential.accessTokenProvider,
    dataPrincipal: credential.principal,
  });
}

export async function createSnapshotRestClient(
  args: SnapshotCommonArguments,
): Promise<FirestoreRestClient> {
  return (await createSnapshotRestRuntime(args)).client;
}

export function requiredAbsolutePath(argv: readonly string[], name: string): string {
  const value = argumentValue(argv, name);
  if (!value) throw new Error(`${name}=<absolute-path> は必須です`);
  if (!isAbsolute(value)) throw new Error(`${name}は絶対pathで指定してください`);
  return resolve(value);
}

export function argumentValue(argv: readonly string[], name: string): string {
  const prefix = `${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

export function reportCutoverCliError(error: unknown): void {
  console.error(sanitizeCutoverCliErrorMessage(error));
}

export function sanitizeCutoverCliErrorMessage(error: unknown): string {
  const code = safeErrorCode(error);
  return code
    ? `cutover command failed (${code}); sensitive details were suppressed`
    : "cutover command failed; sensitive details were suppressed";
}

function safeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(code)
    ? code
    : null;
}

export function assertProductionCredentialHygiene(options: {
  repositoryRoot: string;
  credentialPath?: string;
  mobileDocumentsRoot?: string;
  cloudStorageRoot?: string;
}): void {
  const repositoryRoot = realpathSync(options.repositoryRoot);
  const repositoryCredentialNames = readdirSync(repositoryRoot)
    .filter((name) => (
      name === "firebase-service-account.json"
      || /^.+-firebase-adminsdk-.+\.json$/.test(name)
    ));
  if (repositoryCredentialNames.length > 0) {
    throw new Error("repository直下にservice-account credentialがあるため本番cutoverを停止しました");
  }

  const credentialPath = options.credentialPath?.trim();
  if (!credentialPath) return;
  if (!isAbsolute(credentialPath)) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALSはrepository・同期folder外の絶対pathが必要です");
  }
  let normalizedCredentialPath: string;
  try {
    normalizedCredentialPath = realpathSync(credentialPath);
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALSを安全に検査できません");
  }
  const roots = [
    repositoryRoot,
    options.mobileDocumentsRoot
      ?? join(userInfo().homedir, "Library", "Mobile Documents"),
    options.cloudStorageRoot
      ?? join(userInfo().homedir, "Library", "CloudStorage"),
  ].filter((root) => root && existsSync(root)).map((root) => realpathSync(root));
  if (roots.some((root) => isInside(normalizedCredentialPath, root))) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALSをrepository・同期folder配下から使用できません");
  }
  const stats = statSync(normalizedCredentialPath);
  if (
    !stats.isFile()
    || (stats.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && stats.uid !== process.getuid())
    || stats.nlink !== 1
  ) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALSのowner・permission・hard link条件が不正です");
  }
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isInside(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
