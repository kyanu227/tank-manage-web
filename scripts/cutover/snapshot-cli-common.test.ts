import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS } from "./migration-credential";
import {
  assertProductionCredentialHygiene,
  createDataMigrationFirestoreRestClient,
  createSnapshotRestRuntime,
  parseSnapshotCommonArguments,
  sanitizeCutoverCliErrorMessage,
} from "./snapshot-cli-common";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("cutover CLI production safety", () => {
  it("旧--expected-principalをnetwork・Git検査より前に拒否する", () => {
    expect(() => parseSnapshotCommonArguments([
      "--expected-principal=legacy@example-project.iam.gserviceaccount.com",
    ], [])).toThrow("未知の引数");
  });

  it("production data runtimeは7権限のdata credentialだけを受け取る", async () => {
    const accessTokenProvider = vi.fn(async () => "data-only-token");
    const verifyDataCredential = vi.fn(async () => ({
      kind: "data_migration" as const,
      principal: "data@example-project.iam.gserviceaccount.com",
      projectId: "example-project",
      permissions: DATA_MIGRATION_REQUIRED_IAM_PERMISSIONS,
      accessTokenProvider,
    }));
    const runtime = await createSnapshotRestRuntime({
      projectId: "example-project",
      databaseId: "(default)",
      databaseUid: "database-uid",
      mainCommit: "a".repeat(40),
      keyId: "key-id",
      snapshotStorageMode: "local_encrypted",
      expectedDataPrincipal: "data@example-project.iam.gserviceaccount.com",
      keySource: "keychain",
      repositoryRoot: "/unused",
    }, { verifyDataCredential });

    expect(verifyDataCredential).toHaveBeenCalledWith({
      expectedDataPrincipal: "data@example-project.iam.gserviceaccount.com",
      expectedProjectId: "example-project",
    });
    expect(runtime.credential?.kind).toBe("data_migration");
    expect(runtime.credential?.permissions).toHaveLength(7);
    expect(accessTokenProvider).not.toHaveBeenCalled();
  });

  it("Rules reader token providerをFirestore REST clientへ渡さない", () => {
    const rulesTokenProvider = vi.fn(async () => "rules-only-token");
    expect(() => createDataMigrationFirestoreRestClient({
      projectId: "example-project",
      databaseId: "(default)",
    }, {
      kind: "rules_reader",
      accessTokenProvider: rulesTokenProvider,
    } as never)).toThrow("data migration credential");
    expect(rulesTokenProvider).not.toHaveBeenCalled();
  });

  it("空白を含むdocument ID、CLI path、absolute pathを固定安全文へ置換する", () => {
    const sensitive = [
      "projects/example/databases/(default)/documents/tanks/TANK SECRET",
      "--snapshot=/Users/yuki/My Secret/snapshot.enc",
      "--snapshot='/Users/yuki/My Secret/snapshot.enc'",
      "ENOENT: no such file or directory, open '/Users/yuki/My Secret/snapshot.enc'",
    ];
    sensitive.forEach((raw) => {
      const message = sanitizeCutoverCliErrorMessage(new Error(raw));
      expect(message).toBe("cutover command failed; sensitive details were suppressed");
      expect(message).not.toContain("SECRET");
      expect(message).not.toContain("/Users");
      expect(message).not.toContain("snapshot.enc");
    });
  });

  it("allowlist形式のerrno codeだけをstderrへ残す", () => {
    const error = Object.assign(
      new Error("ENOENT: /Users/yuki/My Secret/snapshot.enc"),
      { code: "ENOENT" },
    );
    expect(sanitizeCutoverCliErrorMessage(error)).toBe(
      "cutover command failed (ENOENT); sensitive details were suppressed",
    );
    expect(sanitizeCutoverCliErrorMessage({
      code: "unsafe path=/Users/yuki/Secret",
      message: "secret",
    })).toBe("cutover command failed; sensitive details were suppressed");
  });

  it("repository直下の既知service-account fileを存在だけで拒否する", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "firebase-service-account.json"), "not-read", { mode: 0o600 });
    expect(() => assertProductionCredentialHygiene({ repositoryRoot: root }))
      .toThrow("repository直下");
  });

  it("同期folder外のowner本人0600通常fileだけを許可する", async () => {
    const root = await temporaryDirectory();
    const safeRoot = await temporaryDirectory();
    const syncRoot = await temporaryDirectory();
    const mobileDocumentsRoot = join(syncRoot, "Mobile Documents");
    const cloudStorageRoot = join(syncRoot, "CloudStorage");
    await mkdir(mobileDocumentsRoot);
    await mkdir(cloudStorageRoot);
    const credentialPath = join(safeRoot, "migration.json");
    await writeFile(credentialPath, "not-read", { mode: 0o600 });
    expect(() => assertProductionCredentialHygiene({
      repositoryRoot: root,
      credentialPath,
      mobileDocumentsRoot,
      cloudStorageRoot,
    })).not.toThrow();

    const syncedCredentialPath = join(cloudStorageRoot, "migration.json");
    await writeFile(syncedCredentialPath, "not-read", { mode: 0o600 });
    expect(() => assertProductionCredentialHygiene({
      repositoryRoot: root,
      credentialPath: syncedCredentialPath,
      mobileDocumentsRoot,
      cloudStorageRoot,
    })).toThrow("同期folder");

    const broadCredentialPath = join(safeRoot, "broad.json");
    await writeFile(broadCredentialPath, "not-read", { mode: 0o644 });
    expect(() => assertProductionCredentialHygiene({
      repositoryRoot: root,
      credentialPath: broadCredentialPath,
      mobileDocumentsRoot,
      cloudStorageRoot,
    })).toThrow("permission");
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cutover-cli-common-"));
  temporaryDirectories.push(directory);
  return directory;
}
