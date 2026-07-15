import { createCipheriv, randomBytes } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalSha256,
  canonicalStringify,
  sha256Hex,
  snapshotFieldSha256,
} from "./canonical-firestore-value";
import {
  MAX_ENCRYPTED_SNAPSHOT_FILE_BYTES,
  assertSafeSnapshotPath,
  decryptTransitionSnapshot,
  encryptTransitionSnapshot,
  readEncryptedSnapshotFile,
  writeEncryptedSnapshotFile,
} from "./snapshot-envelope";
import type {
  EncryptedTransitionSnapshotEnvelopeV1,
  TransitionSnapshotDocumentV1,
  TransitionSnapshotPayloadV1,
} from "./firestore-rest-types";

describe("encrypted transition snapshot envelope", () => {
  it("payload全体をAES-256-GCMで暗号化し同じkey IDで復号する", () => {
    const key = randomBytes(32);
    const payload = fixturePayload();
    const envelope = encryptTransitionSnapshot(payload, key);
    expect(envelope.keyId).toBe("cutover-key-2026-01");
    expect(envelope.ciphertextBase64).not.toContain("T-001");
    expect(decryptTransitionSnapshot(envelope, key, payload.manifest.keyId)).toEqual(payload);
  });

  it("wrong key、wrong key ID、ciphertext改ざんを拒否する", () => {
    const key = randomBytes(32);
    const envelope = encryptTransitionSnapshot(fixturePayload(), key);
    expect(() => decryptTransitionSnapshot(envelope, randomBytes(32), envelope.keyId))
      .toThrow("復号またはAES-GCM");
    expect(() => decryptTransitionSnapshot(envelope, key, "other-key"))
      .toThrow("key ID");

    const tampered: EncryptedTransitionSnapshotEnvelopeV1 = {
      ...envelope,
      ciphertextBase64: `${envelope.ciphertextBase64.slice(0, -4)}AAAA`,
    };
    expect(() => decryptTransitionSnapshot(tampered, key, envelope.keyId))
      .toThrow("ciphertext SHA-256");
  });

  it("AAD header、auth tag、非canonical plaintextの改ざんを拒否する", () => {
    const key = randomBytes(32);
    const envelope = encryptTransitionSnapshot(fixturePayload(), key);
    expect(() => decryptTransitionSnapshot({
      ...envelope,
      snapshotId: "tampered-snapshot-id",
    }, key, envelope.keyId)).toThrow("AES-GCM");

    const authTag = Buffer.from(envelope.authTagBase64, "base64");
    authTag[0] ^= 0xff;
    expect(() => decryptTransitionSnapshot({
      ...envelope,
      authTagBase64: authTag.toString("base64"),
    }, key, envelope.keyId)).toThrow("AES-GCM");

    const nonCanonical = encryptNonCanonicalPayload(fixturePayload(), key);
    expect(() => decryptTransitionSnapshot(nonCanonical, key, nonCanonical.keyId))
      .toThrow("canonical JSON");
  });

  it("repository/iCloud外へ0600・上書き禁止で暗号化fileだけを保存する", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tank-cutover-envelope-"));
    const output = join(directory, "snapshot.cutover.enc");
    const envelope = encryptTransitionSnapshot(fixturePayload(), randomBytes(32));
    try {
      await writeEncryptedSnapshotFile(output, envelope, { repositoryRoot: process.cwd() });
      expect((await stat(output)).mode & 0o077).toBe(0);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(envelope);
      expect(await readEncryptedSnapshotFile(output, { repositoryRoot: process.cwd() }))
        .toEqual(envelope);
      await chmod(output, 0o400);
      await expect(readEncryptedSnapshotFile(output, { repositoryRoot: process.cwd() }))
        .rejects.toThrow("0600");
      await chmod(output, 0o600);
      await expect(writeEncryptedSnapshotFile(output, envelope, { repositoryRoot: process.cwd() }))
        .rejects.toThrow("上書き");
      await expect(assertSafeSnapshotPath(
        join(process.cwd(), "snapshot.cutover.enc"),
        { repositoryRoot: process.cwd() },
      )).rejects.toThrow("repository配下");
      const repositoryLink = join(directory, "repository-link");
      await symlink(process.cwd(), repositoryLink);
      await expect(assertSafeSnapshotPath(
        join(repositoryLink, "snapshot.cutover.enc"),
        { repositoryRoot: process.cwd() },
      )).rejects.toThrow("repository配下");

      const hardLink = join(directory, "snapshot-hard-link.cutover.enc");
      await link(output, hardLink);
      await expect(readEncryptedSnapshotFile(output, { repositoryRoot: process.cwd() }))
        .rejects.toThrow("hard link数");
      await unlink(hardLink);

      const mobileDocumentsRoot = join(directory, "Mobile Documents");
      await mkdir(mobileDocumentsRoot);
      await expect(assertSafeSnapshotPath(
        join(mobileDocumentsRoot, "snapshot.cutover.enc"),
        { repositoryRoot: process.cwd(), mobileDocumentsRoot },
      )).rejects.toThrow("iCloud Mobile Documents配下");

      const cloudStorageRoot = join(directory, "CloudStorage");
      await mkdir(cloudStorageRoot);
      await expect(assertSafeSnapshotPath(
        join(cloudStorageRoot, "snapshot.cutover.enc"),
        { repositoryRoot: process.cwd(), cloudStorageRoot },
      )).rejects.toThrow("同期CloudStorage配下");

      const oversized = join(directory, "oversized.cutover.enc");
      await writeFile(oversized, Buffer.alloc(MAX_ENCRYPTED_SNAPSHOT_FILE_BYTES + 1), {
        mode: 0o600,
      });
      await expect(readEncryptedSnapshotFile(oversized, { repositoryRoot: process.cwd() }))
        .rejects.toThrow("file size上限");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function fixturePayload(): TransitionSnapshotPayloadV1 {
  const databasePrefix = "projects/demo-cutover/databases/(default)";
  const fields = {
    status: { stringValue: "lent" } as const,
    capacity: { integerValue: "10" } as const,
  };
  const document: TransitionSnapshotDocumentV1 = {
    kind: "tank",
    name: `${databasePrefix}/documents/tanks/T-001`,
    fields,
    createTime: "2026-07-13T00:00:00Z",
    updateTime: "2026-07-13T00:00:01.123456Z",
    fieldSha256: snapshotFieldSha256(`${databasePrefix}/documents/tanks/T-001`, fields),
  };
  const documents = [document];
  return {
    manifest: {
      version: 1,
      scope: "transitionPlanRequiredV1",
      snapshotId: "snapshot-fixture-001",
      createdAt: "2026-07-13T00:01:00Z",
      readTime: "2026-07-13T00:00:02Z",
      projectId: "demo-cutover",
      databaseId: "(default)",
      databaseUid: "emulator:demo-cutover:(default)",
      mainCommit: "a".repeat(40),
      keyId: "cutover-key-2026-01",
      migrationMarkerPath: "migrationMarkers/transitionPlanRequiredV1",
      counts: { tanks: 1, tankLogs: 0, transactions: 0, restoreWrites: 2 },
      inventory: {
        totalLogs: 0,
        preservedNonTankLogs: 0,
        unknownLogs: 0,
        totalTransactions: 0,
        preservedTransactions: 0,
        unknownTransactions: 0,
      },
      documentPathSha256: canonicalSha256(documents.map((item) => item.name)),
      sourceCensusSha256: canonicalSha256({
        documents: documents.map((item) => ({
          name: item.name,
          updateTime: item.updateTime,
          fieldSha256: item.fieldSha256,
        })),
        inventory: {
          totalLogs: 0,
          preservedNonTankLogs: 0,
          unknownLogs: 0,
          totalTransactions: 0,
          preservedTransactions: 0,
          unknownTransactions: 0,
        },
        marker: null,
      }),
      snapshotDocumentsSha256: canonicalSha256(documents),
      subcollectionsChecked: 2,
    },
    documents,
  };
}

function encryptNonCanonicalPayload(
  payload: TransitionSnapshotPayloadV1,
  key: Buffer,
): EncryptedTransitionSnapshotEnvelopeV1 {
  const plaintext = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const payloadSha256 = sha256Hex(plaintext);
  const iv = randomBytes(12);
  const header = {
    version: 1 as const,
    algorithm: "AES-256-GCM" as const,
    snapshotId: payload.manifest.snapshotId,
    keyId: payload.manifest.keyId,
    ivBase64: iv.toString("base64"),
    payloadSha256,
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(canonicalStringify(header), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ...header,
    authTagBase64: cipher.getAuthTag().toString("base64"),
    ciphertextSha256: sha256Hex(ciphertext),
    ciphertextBase64: ciphertext.toString("base64"),
  };
}
