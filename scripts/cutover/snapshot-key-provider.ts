import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "tank-manage-cutover";
const KEY_BYTES = 32;

export type SnapshotKeySource = "keychain" | "test-stdin";

export async function loadSnapshotEncryptionKey(input: {
  projectId: string;
  keyId: string;
  source: SnapshotKeySource;
  emulatorHost?: string;
}): Promise<Buffer> {
  if (input.source === "test-stdin") {
    if (!input.emulatorHost) {
      throw new Error("test-stdin key sourceはFirestore Emulatorでだけ使用できます");
    }
    return parseSnapshotKey(await readStdin(), "stdin");
  }

  if (process.platform !== "darwin") {
    throw new Error("本番snapshot鍵はmacOS Keychainからのみ取得できます");
  }
  const account = `${input.projectId}:${input.keyId}`;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", KEYCHAIN_SERVICE, "-a", account],
      { encoding: "utf8", maxBuffer: 4_096 },
    ));
  } catch {
    throw new Error(`Keychainからsnapshot keyを取得できません: ${KEYCHAIN_SERVICE}/${account}`);
  }
  return parseSnapshotKey(stdout, `Keychain ${account}`);
}

export function snapshotKeychainIdentity(projectId: string, keyId: string): {
  service: string;
  account: string;
} {
  return {
    service: KEYCHAIN_SERVICE,
    account: `${projectId}:${keyId}`,
  };
}

export function disposeSnapshotKey(key: Buffer): void {
  key.fill(0);
}

function parseSnapshotKey(value: string, source: string): Buffer {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error(`${source}のsnapshot keyがcanonical base64ではありません`);
  }
  const key = Buffer.from(normalized, "base64");
  if (key.byteLength !== KEY_BYTES || key.toString("base64") !== normalized) {
    key.fill(0);
    throw new Error(`${source}のsnapshot keyは32 bytesである必要があります`);
  }
  return key;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
