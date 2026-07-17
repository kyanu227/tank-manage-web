import {
  decodeCanonicalBase64Key,
  keychainCommandEnvironment,
  runLocalCommand,
  type LocalCommandRunner,
} from "./local-cutover-environment";
import { snapshotKeychainIdentity } from "./snapshot-keychain-identity";

const KEY_BYTES = 32;

export type SnapshotKeySource = "keychain" | "test-stdin";

export async function loadSnapshotEncryptionKey(input: {
  projectId: string;
  keyId: string;
  source: SnapshotKeySource;
  emulatorHost?: string;
}, dependencies: {
  runCommand?: LocalCommandRunner;
  platform?: NodeJS.Platform;
} = {}): Promise<Buffer> {
  if (input.source === "test-stdin") {
    if (!input.emulatorHost) {
      throw new Error("test-stdin key sourceはFirestore Emulatorでだけ使用できます");
    }
    return parseSnapshotKey(await readStdin(), "stdin");
  }

  if ((dependencies.platform ?? process.platform) !== "darwin") {
    throw new Error("本番snapshot鍵はmacOS Keychainからのみ取得できます");
  }
  const identity = snapshotKeychainIdentity(input.projectId, input.keyId);
  let stdout: Buffer | null = null;
  try {
    const result = await (dependencies.runCommand ?? runLocalCommand)({
      executable: "/usr/bin/security",
      args: [
        "find-generic-password",
        "-w",
        "-s",
        identity.service,
        "-a",
        identity.account,
      ],
      environment: keychainCommandEnvironment(),
      sensitiveOutput: true,
    });
    if (result.exitCode !== 0 || !Buffer.isBuffer(result.stdout)) {
      if (Buffer.isBuffer(result.stdout)) result.stdout.fill(0);
      throw new Error("Keychain read failed");
    }
    stdout = result.stdout;
    return decodeCanonicalBase64Key(stdout);
  } catch {
    throw new Error(
      `Keychainからsnapshot keyを取得できません: ${identity.service}/${identity.account}`,
    );
  } finally {
    stdout?.fill(0);
  }
}

export { snapshotKeychainIdentity } from "./snapshot-keychain-identity";

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
