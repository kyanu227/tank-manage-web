import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSha256, snapshotFieldSha256 } from "./canonical-firestore-value";
import {
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
