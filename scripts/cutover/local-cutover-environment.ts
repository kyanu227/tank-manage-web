import { randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import { userInfo } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { snapshotKeychainIdentity } from "./snapshot-key-provider";
import type { SnapshotStorageMode } from "./snapshot-envelope";

const DEFAULT_MAX_CREDENTIAL_FILE_BYTES = 256 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const LOCAL_COMMAND_TIMEOUT_MS = 30_000;
const KEYCHAIN_NOT_FOUND_EXIT_CODE = 44;
const EXCLUDED_DIRECTORY_NAMES = new Set([".git", "node_modules", ".next", "out"]);
const SERVICE_ACCOUNT_EMAIL_PATTERN =
  /^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9.-]+\.gserviceaccount\.com$/u;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

export type RepositoryServiceAccountCredential = {
  projectId: string | null;
  clientEmail: string | null;
  hasLocalKeyId: boolean;
};

/** path、実key ID、private keyを含めない安全な棚卸し結果。 */
export type RepositoryServiceAccountCredentialInventory = {
  credentialFileCount: number;
  uninspectableCandidateCount: number;
  skippedSymlinkCount: number;
  credentials: RepositoryServiceAccountCredential[];
};

export type LocalCommandRequest = {
  executable: string;
  args: readonly string[];
  stdin?: Buffer;
  discardOutput?: boolean;
  /** stdoutを文字列化せずBufferのままcallerへ渡す。callerが必ずzeroizeする。 */
  sensitiveOutput?: boolean;
};

export type LocalCommandResult = {
  exitCode: number;
  stdout: string | Buffer;
};

export type LocalCommandRunner = (
  request: LocalCommandRequest,
) => Promise<LocalCommandResult>;

export type LocalCutoverEnvironmentDependencies = {
  runCommand?: LocalCommandRunner;
  randomBytes?: (size: number) => Buffer;
};

/**
 * repository内のJSONを小さいfileだけ検査する。symlinkを追わず、候補のpathや秘密値は返さない。
 */
export async function inventoryRepositoryServiceAccountCredentials(input: {
  repositoryRoot: string;
  maxFileBytes?: number;
}): Promise<RepositoryServiceAccountCredentialInventory> {
  const repositoryRoot = await realpath(input.repositoryRoot).catch(() => {
    throw new Error("repository rootを安全に解決できません");
  });
  const rootStats = await stat(repositoryRoot).catch(() => {
    throw new Error("repository rootを安全に検査できません");
  });
  if (!rootStats.isDirectory()) {
    throw new Error("repository rootがdirectoryではありません");
  }
  const maxFileBytes = requirePositiveInteger(
    input.maxFileBytes ?? DEFAULT_MAX_CREDENTIAL_FILE_BYTES,
    "credential JSON size上限",
  );
  const credentials: RepositoryServiceAccountCredential[] = [];
  let uninspectableCandidateCount = 0;
  let skippedSymlinkCount = 0;

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
      throw new Error("repository配下を安全に走査できません");
    });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        skippedSymlinkCount += 1;
        // file/dirを問わず追跡先を検査できないためcredential候補としてfail closedにする。
        uninspectableCandidateCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          await visit(join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;

      const filePath = join(directory, entry.name);
      const knownCandidateName = isKnownCredentialCandidateName(entry.name);
      const inspected = await inspectServiceAccountJson(filePath, maxFileBytes);
      if (inspected.kind === "uninspectable") {
        if (knownCandidateName) uninspectableCandidateCount += 1;
        continue;
      }
      if (inspected.kind === "service_account") credentials.push(inspected.credential);
      else if (knownCandidateName && inspected.kind === "invalid_json") {
        uninspectableCandidateCount += 1;
      }
    }
  };

  await visit(repositoryRoot);
  credentials.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return {
    credentialFileCount: credentials.length,
    uninspectableCandidateCount,
    skippedSymlinkCount,
    credentials,
  };
}

export type LocalSnapshotDirectoryStatus = {
  isDirectory: true;
  outsideRepository: true;
  storageMode: SnapshotStorageMode;
  fileSystem: "apfs";
  localMount: true;
};

export type LocalSnapshotDirectoryProvisionResult = LocalSnapshotDirectoryStatus & {
  created: boolean;
};

export type LocalSnapshotDirectoryPlan = Omit<LocalSnapshotDirectoryStatus, "isDirectory"> & {
  status: "missing" | "exact";
};

type LocalSnapshotDirectoryInput = {
  snapshotDirectory: string;
  repositoryRoot: string;
  /** 指定時はpathから判定したmodeとの完全一致を要求する。 */
  storageMode?: SnapshotStorageMode;
  /** test injection用。既定値はambient HOMEではなくOS account home。 */
  homeDirectory?: string;
  /** `.../Library/Mobile Documents` root。 */
  mobileDocumentsRoot?: string;
  cloudStorageRoot?: string;
};

/** 暗号化snapshot保存先をrepository外のlocal APFSまたはiCloud Driveへ分類する。 */
export async function inspectLocalSnapshotDirectory(
  input: LocalSnapshotDirectoryInput,
  dependencies: LocalCutoverEnvironmentDependencies = {},
): Promise<LocalSnapshotDirectoryStatus> {
  if (!isAbsolute(input.snapshotDirectory)) {
    throw new Error("snapshot directoryは絶対pathで指定してください");
  }
  const snapshotDirectory = await realpath(input.snapshotDirectory).catch(() => {
    throw new Error("snapshot directoryを安全に解決できません");
  });
  const directoryStats = await stat(snapshotDirectory).catch(() => {
    throw new Error("snapshot directoryを安全に検査できません");
  });
  if (!directoryStats.isDirectory()) {
    throw new Error("snapshot保存先がdirectoryではありません");
  }
  if (
    (typeof process.getuid === "function" && directoryStats.uid !== process.getuid())
    || (directoryStats.mode & 0o022) !== 0
  ) {
    throw new Error("snapshot directoryは実行user所有かつgroup/world書込み不可である必要があります");
  }
  const repositoryRoot = await realpath(input.repositoryRoot).catch(() => {
    throw new Error("repository rootを安全に解決できません");
  });
  const homeDirectory = input.homeDirectory ?? userInfo().homedir;
  const mobileDocumentsRoot = await optionalRealpath(
    input.mobileDocumentsRoot ?? join(homeDirectory, "Library", "Mobile Documents"),
  );
  const iCloudDriveRoot = await optionalRealpath(
    join(
      input.mobileDocumentsRoot ?? join(homeDirectory, "Library", "Mobile Documents"),
      "com~apple~CloudDocs",
    ),
  );
  const cloudStorageRoot = await optionalRealpath(
    input.cloudStorageRoot ?? join(homeDirectory, "Library", "CloudStorage"),
  );
  const storageMode = classifySnapshotDirectoryStorageMode({
    snapshotDirectory,
    repositoryRoot,
    mobileDocumentsRoot,
    iCloudDriveRoot,
    cloudStorageRoot,
    expectedStorageMode: input.storageMode,
  });
  await assertLocalApfsMount(snapshotDirectory, dependencies.runCommand ?? runLocalCommand);
  return {
    isDirectory: true,
    outsideRepository: true,
    storageMode,
    fileSystem: "apfs",
    localMount: true,
  };
}

/**
 * snapshot directoryを必要な場合だけ0700で一度作成する。
 * recursive mkdirやsymlink追跡を行わず、既存directoryは完全一致時だけ冪等に受理する。
 */
export async function ensureLocalSnapshotDirectory(
  input: LocalSnapshotDirectoryInput & { storageMode: SnapshotStorageMode },
  dependencies: LocalCutoverEnvironmentDependencies = {},
): Promise<LocalSnapshotDirectoryProvisionResult> {
  const plan = await planLocalSnapshotDirectory(input, dependencies);
  if (plan.status === "exact") {
    return {
      isDirectory: true,
      outsideRepository: plan.outsideRepository,
      storageMode: plan.storageMode,
      fileSystem: plan.fileSystem,
      localMount: plan.localMount,
      created: false,
    };
  }

  const requestedDirectory = resolve(input.snapshotDirectory);
  try {
    await mkdir(requestedDirectory, { mode: 0o700 });
  } catch {
    throw new Error("snapshot directoryを排他的に作成できません");
  }
  const createdStats = await lstat(requestedDirectory).catch(() => {
    throw new Error("作成したsnapshot directoryを再検査できません");
  });
  assertExactProvisionedDirectory(createdStats);
  await assertNoSymlinkTraversal(requestedDirectory);
  return {
    isDirectory: true,
    outsideRepository: true,
    storageMode: input.storageMode,
    fileSystem: "apfs",
    localMount: true,
    created: true,
  };
}

/**
 * 作成予定のsnapshot directoryをread-onlyで検査し、missingまたは完全一致だけを返す。
 * missing時もparent・path policy・mountを検査するがfilesystem mutationは行わない。
 */
export async function planLocalSnapshotDirectory(
  input: LocalSnapshotDirectoryInput & { storageMode: SnapshotStorageMode },
  dependencies: LocalCutoverEnvironmentDependencies = {},
): Promise<LocalSnapshotDirectoryPlan> {
  if (!isAbsolute(input.snapshotDirectory)) {
    throw new Error("snapshot directoryは絶対pathで指定してください");
  }
  const requestedDirectory = resolve(input.snapshotDirectory);
  const current = await lstat(requestedDirectory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("snapshot directoryを安全に検査できません");
  });
  if (current) {
    await assertNoSymlinkTraversal(requestedDirectory);
    assertExactProvisionedDirectory(current);
    const inspected = await inspectLocalSnapshotDirectory({
      ...input,
      snapshotDirectory: requestedDirectory,
    }, dependencies);
    return {
      status: "exact",
      outsideRepository: inspected.outsideRepository,
      storageMode: inspected.storageMode,
      fileSystem: inspected.fileSystem,
      localMount: inspected.localMount,
    };
  }

  const requestedParent = dirname(requestedDirectory);
  await assertNoSymlinkTraversal(requestedParent);
  const parent = await realpath(requestedParent).catch(() => {
    throw new Error("snapshot directoryのparentを安全に解決できません");
  });
  if (parent !== requestedParent) {
    throw new Error("snapshot directoryのparentにsymlinkを使用できません");
  }
  const parentStats = await lstat(parent).catch(() => {
    throw new Error("snapshot directoryのparentを安全に検査できません");
  });
  assertSafeParentDirectory(parentStats);

  const repositoryRoot = await realpath(input.repositoryRoot).catch(() => {
    throw new Error("repository rootを安全に解決できません");
  });
  const homeDirectory = input.homeDirectory ?? userInfo().homedir;
  const mobileDocumentsPath = input.mobileDocumentsRoot
    ?? join(homeDirectory, "Library", "Mobile Documents");
  const mobileDocumentsRoot = await optionalRealpath(mobileDocumentsPath);
  const iCloudDriveRoot = await optionalRealpath(join(mobileDocumentsPath, "com~apple~CloudDocs"));
  const cloudStorageRoot = await optionalRealpath(
    input.cloudStorageRoot ?? join(homeDirectory, "Library", "CloudStorage"),
  );
  classifySnapshotDirectoryStorageMode({
    snapshotDirectory: requestedDirectory,
    repositoryRoot,
    mobileDocumentsRoot,
    iCloudDriveRoot,
    cloudStorageRoot,
    expectedStorageMode: input.storageMode,
  });
  await assertLocalApfsMount(parent, dependencies.runCommand ?? runLocalCommand);
  return {
    status: "missing",
    outsideRepository: true,
    storageMode: input.storageMode,
    fileSystem: "apfs",
    localMount: true,
  };
}

function classifySnapshotDirectoryStorageMode(input: {
  snapshotDirectory: string;
  repositoryRoot: string;
  mobileDocumentsRoot: string | null;
  iCloudDriveRoot: string | null;
  cloudStorageRoot: string | null;
  expectedStorageMode?: SnapshotStorageMode;
}): SnapshotStorageMode {
  if (isInside(input.snapshotDirectory, input.repositoryRoot)) {
    throw new Error("snapshot directoryをrepository配下に指定できません");
  }
  if (input.cloudStorageRoot && isInside(input.snapshotDirectory, input.cloudStorageRoot)) {
    throw new Error("snapshot directoryをiCloud以外の同期folder配下に指定できません");
  }
  const insideMobileDocuments = Boolean(
    input.mobileDocumentsRoot
    && isInside(input.snapshotDirectory, input.mobileDocumentsRoot),
  );
  const insideICloudDrive = Boolean(
    input.iCloudDriveRoot
    && isInside(input.snapshotDirectory, input.iCloudDriveRoot),
  );
  if (insideMobileDocuments && !insideICloudDrive) {
    throw new Error(
      "icloud_encryptedはOS account homeのcom~apple~CloudDocs配下だけを使用できます",
    );
  }
  const actualStorageMode: SnapshotStorageMode = insideICloudDrive
    ? "icloud_encrypted"
    : "local_encrypted";
  if (
    input.expectedStorageMode !== undefined
    && input.expectedStorageMode !== actualStorageMode
  ) {
    throw new Error("snapshot directoryと指定storage modeが一致しません");
  }
  return actualStorageMode;
}

async function assertLocalApfsMount(
  targetPath: string,
  runCommand: LocalCommandRunner,
): Promise<void> {
  const result = await runCommand({ executable: "/sbin/mount", args: [] });
  if (result.exitCode !== 0) {
    throw new Error("local mount情報を取得できません");
  }
  if (typeof result.stdout !== "string") {
    result.stdout.fill(0);
    throw new Error("local mount情報の形式が不正です");
  }
  const mount = findContainingMount(targetPath, result.stdout);
  if (!mount) throw new Error("snapshot directoryのmountを特定できません");
  if (!mount.options.has("apfs") || !mount.options.has("local")) {
    throw new Error("snapshot directoryはlocal APFS上である必要があります");
  }
}

async function assertNoSymlinkTraversal(targetPath: string): Promise<void> {
  const normalized = resolve(targetPath);
  const root = parse(normalized).root;
  const parts = relative(root, normalized).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const currentStats = await lstat(current).catch(() => {
      throw new Error("snapshot directory pathを安全に検査できません");
    });
    if (currentStats.isSymbolicLink()) {
      throw new Error("snapshot directory pathにsymlinkを使用できません");
    }
  }
}

function assertSafeParentDirectory(stats: Stats): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("snapshot directoryのparentが通常directoryではありません");
  }
  assertCurrentUserOwner(stats, "snapshot directoryのparent");
  if ((stats.mode & 0o022) !== 0) {
    throw new Error("snapshot directoryのparentはgroup/world書込み不可である必要があります");
  }
}

function assertExactProvisionedDirectory(stats: Stats): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("snapshot保存先が通常directoryではありません");
  }
  assertCurrentUserOwner(stats, "snapshot directory");
  if ((stats.mode & 0o777) !== 0o700) {
    throw new Error("snapshot directoryのpermissionは0700である必要があります");
  }
}

function assertCurrentUserOwner(stats: Stats, label: string): void {
  if (typeof process.getuid !== "function" || stats.uid !== process.getuid()) {
    throw new Error(`${label}は実行user所有である必要があります`);
  }
}

export type SnapshotKeychainEntryStatus = {
  exists: boolean;
};

/** Keychain値をBufferで一時取得し、32-byte canonical Base64として検証後にzeroizeする。 */
export async function inspectSnapshotKeychainEntry(
  input: { projectId: string; keyId: string },
  dependencies: LocalCutoverEnvironmentDependencies = {},
): Promise<SnapshotKeychainEntryStatus> {
  if (process.platform !== "darwin") {
    throw new Error("snapshot Keychain準備はmacOSでだけ実行できます");
  }
  const identity = validatedKeychainIdentity(input.projectId, input.keyId);
  const key = await readSnapshotKeychainKey(
    identity,
    dependencies.runCommand ?? runLocalCommand,
  );
  if (!key) return { exists: false };
  key.fill(0);
  return { exists: true };
}

/**
 * 32-byte keyを生成し、既存entryを上書きせずKeychainへ登録する。key本文は返さない。
 */
export async function createSnapshotKeychainEntry(
  input: { projectId: string; keyId: string },
  dependencies: LocalCutoverEnvironmentDependencies = {},
): Promise<{ created: true }> {
  if (process.platform !== "darwin") {
    throw new Error("snapshot Keychain準備はmacOSでだけ実行できます");
  }
  const runCommand = dependencies.runCommand ?? runLocalCommand;
  const current = await inspectSnapshotKeychainEntry(input, { ...dependencies, runCommand });
  if (current.exists) throw new Error("既存Keychain entryは上書きしません");

  const identity = validatedKeychainIdentity(input.projectId, input.keyId);
  const key = (dependencies.randomBytes ?? nodeRandomBytes)(32);
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
    if (Buffer.isBuffer(key)) key.fill(0);
    throw new Error("snapshot key生成結果が32 bytesではありません");
  }
  let encoded: Buffer | null = null;
  let encodedInput: Buffer | null = null;
  try {
    encoded = encodeCanonicalBase64Key(key);
    encodedInput = Buffer.alloc(encoded.byteLength + 1);
    encoded.copy(encodedInput);
    encodedInput[encodedInput.byteLength - 1] = 0x0a;
    const args = [
      "add-generic-password",
      "-s",
      identity.service,
      "-a",
      identity.account,
      "-w",
    ];
    if (args.includes("-U") || args.at(-1) !== "-w") {
      throw new Error("Keychain登録commandの上書き防止条件が不正です");
    }
    const result = await runCommand({
      executable: "/usr/bin/security",
      args,
      stdin: encodedInput,
      discardOutput: true,
    });
    if (result.exitCode !== 0) {
      throw new Error("snapshot keyをKeychainへ登録できません");
    }
    const stored = await readSnapshotKeychainKey(identity, runCommand);
    try {
      if (
        !stored
        || stored.byteLength !== key.byteLength
        || !timingSafeEqual(stored, key)
      ) {
        throw new Error("Keychain登録後のkey一致を確認できません");
      }
    } finally {
      stored?.fill(0);
    }
    return { created: true };
  } finally {
    key.fill(0);
    encoded?.fill(0);
    encodedInput?.fill(0);
  }
}

export const runLocalCommand: LocalCommandRunner = async (request) => new Promise((resolve, reject) => {
  if (request.discardOutput && request.sensitiveOutput) {
    reject(new Error("local command output取扱いが不正です"));
    return;
  }
  const child = spawn(request.executable, [...request.args], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  let settled = false;
  let invalidSensitiveChunk = false;
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, LOCAL_COMMAND_TIMEOUT_MS);
  const finishWithError = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    chunks.forEach((chunk) => chunk.fill(0));
    reject(new Error("local commandを安全に実行できません"));
  };

  child.on("error", finishWithError);
  child.stdout.on("data", (chunk: Buffer | string) => {
    if (request.sensitiveOutput && typeof chunk === "string") {
      invalidSensitiveChunk = true;
      child.kill("SIGKILL");
      return;
    }
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (request.discardOutput) {
      value.fill(0);
      return;
    }
    outputBytes += value.byteLength;
    if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
      value.fill(0);
      child.kill("SIGKILL");
      return;
    }
    chunks.push(value);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (Buffer.isBuffer(chunk)) chunk.fill(0);
  });
  child.on("close", (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (outputBytes > MAX_COMMAND_OUTPUT_BYTES || invalidSensitiveChunk) {
      chunks.forEach((chunk) => chunk.fill(0));
      reject(new Error(
        outputBytes > MAX_COMMAND_OUTPUT_BYTES
          ? "local command outputがsize上限を超えました"
          : "sensitive command outputの形式が不正です",
      ));
      return;
    }
    let stdout: string | Buffer = "";
    if (!request.discardOutput) {
      const combined = Buffer.concat(chunks);
      if (request.sensitiveOutput) {
        stdout = combined;
      } else {
        stdout = combined.toString("utf8");
        combined.fill(0);
      }
    }
    chunks.forEach((chunk) => chunk.fill(0));
    resolve({ exitCode: typeof code === "number" ? code : -1, stdout });
  });
  if (request.stdin) child.stdin.end(request.stdin);
  else child.stdin.end();
});

async function readSnapshotKeychainKey(
  identity: { service: string; account: string },
  runCommand: LocalCommandRunner,
): Promise<Buffer | null> {
  const result = await runCommand({
    executable: "/usr/bin/security",
    args: [
      "find-generic-password",
      "-w",
      "-s",
      identity.service,
      "-a",
      identity.account,
    ],
    sensitiveOutput: true,
  });
  if (result.exitCode === KEYCHAIN_NOT_FOUND_EXIT_CODE) {
    if (Buffer.isBuffer(result.stdout)) result.stdout.fill(0);
    return null;
  }
  if (result.exitCode !== 0 || !Buffer.isBuffer(result.stdout)) {
    if (Buffer.isBuffer(result.stdout)) result.stdout.fill(0);
    throw new Error("Keychain entryを安全に検証できません");
  }
  const raw = result.stdout;
  try {
    return decodeCanonicalBase64Key(raw);
  } finally {
    raw.fill(0);
  }
}

function encodeCanonicalBase64Key(key: Buffer): Buffer {
  if (key.byteLength !== 32) throw new Error("snapshot keyのsizeが不正です");
  const alphabet = Buffer.from(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    "ascii",
  );
  const encoded = Buffer.alloc(44);
  let sourceOffset = 0;
  let targetOffset = 0;
  while (sourceOffset + 3 <= key.byteLength) {
    const first = key[sourceOffset];
    const second = key[sourceOffset + 1];
    const third = key[sourceOffset + 2];
    encoded[targetOffset] = alphabet[first >>> 2];
    encoded[targetOffset + 1] = alphabet[((first & 0x03) << 4) | (second >>> 4)];
    encoded[targetOffset + 2] = alphabet[((second & 0x0f) << 2) | (third >>> 6)];
    encoded[targetOffset + 3] = alphabet[third & 0x3f];
    sourceOffset += 3;
    targetOffset += 4;
  }
  const first = key[sourceOffset];
  const second = key[sourceOffset + 1];
  encoded[targetOffset] = alphabet[first >>> 2];
  encoded[targetOffset + 1] = alphabet[((first & 0x03) << 4) | (second >>> 4)];
  encoded[targetOffset + 2] = alphabet[(second & 0x0f) << 2];
  encoded[targetOffset + 3] = 0x3d;
  alphabet.fill(0);
  return encoded;
}

function decodeCanonicalBase64Key(raw: Buffer): Buffer {
  let end = raw.byteLength;
  if (end > 0 && raw[end - 1] === 0x0a) {
    end -= 1;
    if (end > 0 && raw[end - 1] === 0x0d) end -= 1;
  }
  const encoded = raw.subarray(0, end);
  if (encoded.byteLength !== 44 || encoded[43] !== 0x3d) {
    throw new Error("Keychain entryのkey形式が不正です");
  }
  const decoded = Buffer.alloc(32);
  try {
    let sourceOffset = 0;
    let targetOffset = 0;
    while (sourceOffset < 40) {
      const first = base64Value(encoded[sourceOffset]);
      const second = base64Value(encoded[sourceOffset + 1]);
      const third = base64Value(encoded[sourceOffset + 2]);
      const fourth = base64Value(encoded[sourceOffset + 3]);
      if (first < 0 || second < 0 || third < 0 || fourth < 0) {
        throw new Error("Keychain entryのkey形式が不正です");
      }
      decoded[targetOffset] = (first << 2) | (second >>> 4);
      decoded[targetOffset + 1] = ((second & 0x0f) << 4) | (third >>> 2);
      decoded[targetOffset + 2] = ((third & 0x03) << 6) | fourth;
      sourceOffset += 4;
      targetOffset += 3;
    }
    const first = base64Value(encoded[40]);
    const second = base64Value(encoded[41]);
    const third = base64Value(encoded[42]);
    if (first < 0 || second < 0 || third < 0 || (third & 0x03) !== 0) {
      throw new Error("Keychain entryのkey形式が不正です");
    }
    decoded[30] = (first << 2) | (second >>> 4);
    decoded[31] = ((second & 0x0f) << 4) | (third >>> 2);

    const canonical = encodeCanonicalBase64Key(decoded);
    try {
      if (!timingSafeEqual(canonical, encoded)) {
        throw new Error("Keychain entryのkey形式が不正です");
      }
    } finally {
      canonical.fill(0);
    }
    return decoded;
  } catch (error) {
    decoded.fill(0);
    throw error;
  }
}

function base64Value(value: number): number {
  if (value >= 0x41 && value <= 0x5a) return value - 0x41;
  if (value >= 0x61 && value <= 0x7a) return value - 0x61 + 26;
  if (value >= 0x30 && value <= 0x39) return value - 0x30 + 52;
  if (value === 0x2b) return 62;
  if (value === 0x2f) return 63;
  return -1;
}

type JsonInspectionResult =
  | { kind: "service_account"; credential: RepositoryServiceAccountCredential }
  | { kind: "other" }
  | { kind: "invalid_json" }
  | { kind: "uninspectable" };

async function inspectServiceAccountJson(
  filePath: string,
  maxFileBytes: number,
): Promise<JsonInspectionResult> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let raw: Buffer | null = null;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const fileStats = await handle.stat();
    if (!fileStats.isFile() || fileStats.size > maxFileBytes) return { kind: "uninspectable" };
    raw = await handle.readFile();
    if (raw.byteLength > maxFileBytes) return { kind: "uninspectable" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return { kind: "invalid_json" };
    }
    if (!isRecord(parsed) || parsed.type !== "service_account") return { kind: "other" };
    return {
      kind: "service_account",
      credential: {
        projectId: safeProjectId(parsed.project_id),
        clientEmail: safeServiceAccountEmail(parsed.client_email),
        hasLocalKeyId: typeof parsed.private_key_id === "string" && parsed.private_key_id.length > 0,
      },
    };
  } catch {
    throw new Error("repository内JSONを安全に検査できません");
  } finally {
    raw?.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

function isKnownCredentialCandidateName(name: string): boolean {
  const normalized = basename(name).toLowerCase();
  return normalized === "firebase-service-account.json"
    || /firebase-adminsdk-.+\.json$/u.test(normalized)
    || /service[-_]?account.*\.json$/u.test(normalized);
}

function safeProjectId(value: unknown): string | null {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value) ? value : null;
}

function safeServiceAccountEmail(value: unknown): string | null {
  return typeof value === "string" && SERVICE_ACCOUNT_EMAIL_PATTERN.test(value) ? value : null;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}が不正です`);
  return value;
}

async function optionalRealpath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("同期folder rootを安全に解決できません");
  }
}

function findContainingMount(
  targetPath: string,
  mountOutput: string,
): { options: Set<string> } | null {
  const matches = mountOutput.split(/\r?\n/u).flatMap((line) => {
    const match = /^.+ on (.+) \(([^()]*)\)$/u.exec(line.trim());
    if (!match) return [];
    const mountPoint = match[1].replace(/\\040/gu, " ");
    if (!isAbsolute(mountPoint) || !isInside(targetPath, mountPoint)) return [];
    const options = new Set(match[2].split(",").map((option) => option.trim().toLowerCase()));
    return [{ mountPoint, options }];
  });
  matches.sort((left, right) => right.mountPoint.length - left.mountPoint.length);
  return matches[0] ? { options: matches[0].options } : null;
}

function validatedKeychainIdentity(projectId: string, keyId: string): {
  service: string;
  account: string;
} {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Keychain project IDが不正です");
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error("Keychain key IDが不正です");
  return snapshotKeychainIdentity(projectId, keyId);
}

function isInside(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
