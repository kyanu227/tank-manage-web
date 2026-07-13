import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  link,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  canonicalSha256,
  canonicalStringify,
  sha256Hex,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import type {
  EncryptedTransitionSnapshotEnvelopeV1,
  TransitionSnapshotPayloadV1,
} from "./firestore-rest-types";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_ALGORITHM = "AES-256-GCM";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type SnapshotOutputPolicy = {
  repositoryRoot: string;
  mobileDocumentsRoot?: string;
};

export function encryptTransitionSnapshot(
  payloadInput: TransitionSnapshotPayloadV1,
  key: Uint8Array,
): EncryptedTransitionSnapshotEnvelopeV1 {
  assertEncryptionKey(key);
  const payload = validateTransitionSnapshotPayload(payloadInput);
  const plaintext = Buffer.from(canonicalStringify(payload), "utf8");
  const payloadSha256 = sha256Hex(plaintext);
  const iv = randomBytes(IV_BYTES);
  const header = {
    version: 1 as const,
    algorithm: "AES-256-GCM" as const,
    snapshotId: payload.manifest.snapshotId,
    keyId: payload.manifest.keyId,
    ivBase64: iv.toString("base64"),
    payloadSha256,
  };
  const aad = Buffer.from(canonicalStringify(header), "utf8");
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ...header,
    authTagBase64: authTag.toString("base64"),
    ciphertextSha256: sha256Hex(ciphertext),
    ciphertextBase64: ciphertext.toString("base64"),
  };
}

export function decryptTransitionSnapshot(
  envelopeInput: unknown,
  key: Uint8Array,
  expectedKeyId?: string,
): TransitionSnapshotPayloadV1 {
  assertEncryptionKey(key);
  const envelope = normalizeEnvelope(envelopeInput);
  if (expectedKeyId && envelope.keyId !== expectedKeyId) {
    throw new Error(`snapshot key IDが一致しません: ${envelope.keyId}`);
  }
  const ciphertext = Buffer.from(envelope.ciphertextBase64, "base64");
  assertDigestEquals(sha256Hex(ciphertext), envelope.ciphertextSha256, "ciphertext SHA-256");
  const header = {
    version: envelope.version,
    algorithm: envelope.algorithm,
    snapshotId: envelope.snapshotId,
    keyId: envelope.keyId,
    ivBase64: envelope.ivBase64,
    payloadSha256: envelope.payloadSha256,
  };
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.ivBase64, "base64"),
  );
  decipher.setAAD(Buffer.from(canonicalStringify(header), "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.authTagBase64, "base64"));

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("snapshotの復号またはAES-GCM改ざん検証に失敗しました");
  }
  assertDigestEquals(sha256Hex(plaintext), envelope.payloadSha256, "payload SHA-256");

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("snapshot payloadが有効なJSONではありません");
  }
  const payload = validateTransitionSnapshotPayload(parsed);
  const canonicalPlaintext = Buffer.from(canonicalStringify(payload), "utf8");
  if (
    plaintext.byteLength !== canonicalPlaintext.byteLength
    || !timingSafeEqual(plaintext, canonicalPlaintext)
  ) {
    throw new Error("snapshot payloadがcanonical JSONではありません");
  }
  if (payload.manifest.snapshotId !== envelope.snapshotId) {
    throw new Error("envelopeとmanifestのsnapshot IDが一致しません");
  }
  if (payload.manifest.keyId !== envelope.keyId) {
    throw new Error("envelopeとmanifestのkey IDが一致しません");
  }
  return payload;
}

export async function writeEncryptedSnapshotFile(
  outputPath: string,
  envelope: EncryptedTransitionSnapshotEnvelopeV1,
  policy: SnapshotOutputPolicy,
): Promise<void> {
  const safeOutputPath = await assertSafeSnapshotPath(outputPath, policy);
  const directory = dirname(safeOutputPath);
  const temporaryPath = join(directory, `.${basename(safeOutputPath)}.${randomUUID()}.tmp`);
  const body = `${canonicalStringify(normalizeEnvelope(envelope))}\n`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(body, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;

    // hard linkは既存outputを上書きしない。同一directoryなので同一filesystem上で完結する。
    await link(temporaryPath, safeOutputPath);
    await unlink(temporaryPath);
    const directoryHandle = await open(directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  await assertSnapshotFileMetadata(safeOutputPath);
}

export async function readEncryptedSnapshotFile(
  snapshotPath: string,
  policy: SnapshotOutputPolicy,
): Promise<EncryptedTransitionSnapshotEnvelopeV1> {
  const safeSnapshotPath = await assertSafeSnapshotPath(snapshotPath, policy, true);
  const raw = await readFile(safeSnapshotPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("snapshot envelopeが有効なJSONではありません");
  }
  return normalizeEnvelope(parsed);
}

export async function assertSafeSnapshotPath(
  snapshotPath: string,
  policy: SnapshotOutputPolicy,
  mustExist = false,
): Promise<string> {
  if (!isAbsolute(snapshotPath)) throw new Error("snapshot pathは絶対pathで指定してください");
  const resolvedPath = resolve(snapshotPath);
  const normalizedPath = mustExist
    ? await realpath(resolvedPath)
    : join(await realpath(dirname(resolvedPath)), basename(resolvedPath));
  const repositoryRoot = await normalizeExistingPath(policy.repositoryRoot);
  if (!repositoryRoot) throw new Error("repository rootを解決できません");
  const mobileDocumentsRoot = await normalizeExistingPath(
    policy.mobileDocumentsRoot
      ?? join(process.env.HOME ?? "", "Library", "Mobile Documents"),
    true,
  );
  if (isInside(normalizedPath, repositoryRoot)) {
    throw new Error("snapshotをrepository配下へ保存・読取できません");
  }
  if (mobileDocumentsRoot && isInside(normalizedPath, mobileDocumentsRoot)) {
    throw new Error("snapshotをiCloud Mobile Documents配下へ保存・読取できません");
  }
  if (mustExist) {
    await access(normalizedPath, fsConstants.R_OK);
    await assertSnapshotFileMetadata(normalizedPath);
  } else {
    await access(dirname(normalizedPath), fsConstants.W_OK);
    await access(normalizedPath, fsConstants.F_OK)
      .then(() => {
        throw new Error("既存snapshot fileは上書きしません");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "既存snapshot fileは上書きしません") {
          throw error;
        }
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      });
  }
  return normalizedPath;
}

export function envelopePayloadSha256(
  envelope: EncryptedTransitionSnapshotEnvelopeV1,
): string {
  return normalizeEnvelope(envelope).payloadSha256;
}

export function snapshotEnvelopeSha256(
  envelope: EncryptedTransitionSnapshotEnvelopeV1,
): string {
  return canonicalSha256(normalizeEnvelope(envelope));
}

function normalizeEnvelope(input: unknown): EncryptedTransitionSnapshotEnvelopeV1 {
  const record = objectRecord(input, "snapshot envelope");
  assertOnlyKeys(record, [
    "version", "algorithm", "snapshotId", "keyId", "ivBase64", "authTagBase64",
    "payloadSha256", "ciphertextSha256", "ciphertextBase64",
  ], "snapshot envelope");
  if (record.version !== 1 || record.algorithm !== ENVELOPE_ALGORITHM) {
    throw new Error("snapshot envelopeのversionまたはalgorithmが不正です");
  }
  return {
    version: 1,
    algorithm: ENVELOPE_ALGORITHM,
    snapshotId: nonEmptyString(record.snapshotId, "snapshotId"),
    keyId: nonEmptyString(record.keyId, "keyId"),
    ivBase64: fixedBase64(record.ivBase64, IV_BYTES, "ivBase64"),
    authTagBase64: fixedBase64(record.authTagBase64, 16, "authTagBase64"),
    payloadSha256: sha256String(record.payloadSha256, "payloadSha256"),
    ciphertextSha256: sha256String(record.ciphertextSha256, "ciphertextSha256"),
    ciphertextBase64: canonicalBase64(record.ciphertextBase64, "ciphertextBase64"),
  };
}

function assertEncryptionKey(key: Uint8Array): void {
  if (key.byteLength !== KEY_BYTES) throw new Error("snapshot encryption keyは32 bytes必要です");
}

function assertDigestEquals(actual: string, expected: string, label: string): void {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error(`${label}が一致しません`);
  }
}

async function normalizeExistingPath(path: string, optional = false): Promise<string | null> {
  if (!path) return optional ? null : resolve(path);
  try {
    return await realpath(path);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

function isInside(target: string, parent: string): boolean {
  const nested = relative(parent, target);
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}はobjectである必要があります`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`${label}に未知fieldがあります: ${unknown.join(", ")}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${label}は前後に空白のない必須文字列です`);
  }
  return value;
}

async function assertSnapshotFileMetadata(snapshotPath: string): Promise<void> {
  const stats = await stat(snapshotPath);
  if (!stats.isFile()) throw new Error("snapshot pathが通常fileではありません");
  if ((stats.mode & 0o077) !== 0) {
    throw new Error("snapshot fileのpermissionが0600ではありません");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("snapshot fileのownerが実行userではありません");
  }
  if (stats.nlink !== 1) {
    throw new Error("snapshot fileのhard link数が1ではありません");
  }
}

function sha256String(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label}はSHA-256 hexではありません`);
  }
  return value;
}

function canonicalBase64(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw new Error(`${label}はbase64ではありません`);
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) throw new Error(`${label}はcanonical base64ではありません`);
  return value;
}

function fixedBase64(value: unknown, bytes: number, label: string): string {
  const normalized = canonicalBase64(value, label);
  if (Buffer.from(normalized, "base64").byteLength !== bytes) {
    throw new Error(`${label}のbyte長が不正です`);
  }
  return normalized;
}
