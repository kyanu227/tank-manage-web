import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSnapshotKeychainEntry,
  inspectLocalSnapshotDirectory,
  inspectSnapshotKeychainEntry,
  inventoryRepositoryServiceAccountCredentials,
  type LocalCommandRequest,
} from "./local-cutover-environment";

const temporaryDirectories: string[] = [];
const PROJECT_ID = "okmarine-tankrental";
const KEY_ID = "transition-cutover-2026";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
  vi.restoreAllMocks();
});

describe("repository service-account credential inventory", () => {
  it("nested service_account JSONを数え、path・key ID・private keyをDTOへ出さない", async () => {
    const repositoryRoot = await temporaryDirectory("cutover-repository-");
    await mkdir(join(repositoryRoot, "ignored", "nested"), { recursive: true });
    const localKeyId = "sensitive-local-key-id";
    const privateKey = "sensitive-private-key-value-must-not-leak";
    await writeFile(join(repositoryRoot, "ignored", "nested", "unusual-name.json"), JSON.stringify({
      type: "service_account",
      project_id: PROJECT_ID,
      client_email: `legacy-admin@${PROJECT_ID}.iam.gserviceaccount.com`,
      private_key_id: localKeyId,
      private_key: privateKey,
    }));

    const result = await inventoryRepositoryServiceAccountCredentials({ repositoryRoot });

    expect(result).toEqual({
      credentialFileCount: 1,
      uninspectableCandidateCount: 0,
      skippedSymlinkCount: 0,
      credentials: [{
        projectId: PROJECT_ID,
        clientEmail: `legacy-admin@${PROJECT_ID}.iam.gserviceaccount.com`,
        hasLocalKeyId: true,
      }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("unusual-name.json");
    expect(serialized).not.toContain(localKeyId);
    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain(repositoryRoot);
  });

  it("除外directoryとsymlinkを追わず、oversize既知候補をuninspectableにする", async () => {
    const repositoryRoot = await temporaryDirectory("cutover-repository-");
    const outsideRoot = await temporaryDirectory("cutover-outside-");
    const credential = JSON.stringify({
      type: "service_account",
      project_id: PROJECT_ID,
      client_email: `outside@${PROJECT_ID}.iam.gserviceaccount.com`,
      private_key_id: "outside-key-id",
    });
    await writeFile(join(outsideRoot, "credential.json"), credential);
    await symlink(join(outsideRoot, "credential.json"), join(repositoryRoot, "linked.json"));
    await symlink(outsideRoot, join(repositoryRoot, "linked-directory"));
    for (const excluded of [".git", "node_modules", ".next", "out"]) {
      await mkdir(join(repositoryRoot, excluded), { recursive: true });
      await writeFile(join(repositoryRoot, excluded, "credential.json"), credential);
    }
    await writeFile(
      join(repositoryRoot, "firebase-service-account.json"),
      Buffer.alloc(129, 0x61),
    );

    const result = await inventoryRepositoryServiceAccountCredentials({
      repositoryRoot,
      maxFileBytes: 128,
    });

    expect(result.credentialFileCount).toBe(0);
    expect(result.uninspectableCandidateCount).toBe(3);
    expect(result.skippedSymlinkCount).toBe(2);
  });

  it("不正metadataをsafe nullへ落とし、実値を出力しない", async () => {
    const repositoryRoot = await temporaryDirectory("cutover-repository-");
    await writeFile(join(repositoryRoot, "service-account-invalid.json"), JSON.stringify({
      type: "service_account",
      project_id: "/private/project/path",
      client_email: "secret bearer token",
      private_key_id: "raw-key-id-must-not-leak",
    }));

    const result = await inventoryRepositoryServiceAccountCredentials({ repositoryRoot });

    expect(result.credentials).toEqual([{
      projectId: null,
      clientEmail: null,
      hasLocalKeyId: true,
    }]);
    expect(JSON.stringify(result)).not.toContain("raw-key-id-must-not-leak");
    expect(JSON.stringify(result)).not.toContain("/private/project/path");
    expect(JSON.stringify(result)).not.toContain("bearer token");
  });
});

describe("local snapshot directory inspection", () => {
  it("realpath後に最深mountのAPFS + localを確認する", async () => {
    const repositoryRoot = await temporaryDirectory("cutover-repository-");
    const snapshotDirectory = await temporaryDirectory("cutover-snapshot-");
    const command = vi.fn(async () => ({
      exitCode: 0,
      stdout: [
        "/dev/disk1s1 on / (apfs, local, journaled)",
        `/dev/disk1s2 on ${snapshotDirectory} (apfs, local, journaled)`,
      ].join("\n"),
    }));

    await expect(inspectLocalSnapshotDirectory({
      snapshotDirectory,
      repositoryRoot,
      mobileDocumentsRoot: join(snapshotDirectory, "missing-mobile-root"),
      cloudStorageRoot: join(snapshotDirectory, "missing-cloud-root"),
    }, { runCommand: command })).resolves.toEqual({
      isDirectory: true,
      outsideRepository: true,
      outsideSyncRoots: true,
      fileSystem: "apfs",
      localMount: true,
    });
    expect(command).toHaveBeenCalledWith({ executable: "/sbin/mount", args: [] });
  });

  it("repository・同期folder・non-local/non-APFSを拒否する", async () => {
    const root = await temporaryDirectory("cutover-path-policy-");
    const repositoryRoot = join(root, "repository");
    const mobileRoot = join(root, "Mobile Documents");
    const safeRoot = join(root, "safe");
    await Promise.all([
      mkdir(repositoryRoot),
      mkdir(mobileRoot),
      mkdir(safeRoot),
    ]);
    const resolvedSafeRoot = await realpath(safeRoot);
    await expect(inspectLocalSnapshotDirectory({
      snapshotDirectory: repositoryRoot,
      repositoryRoot,
      mobileDocumentsRoot: mobileRoot,
      cloudStorageRoot: join(root, "missing-cloud-root"),
    }, { runCommand: vi.fn() })).rejects.toThrow("repository配下");
    await expect(inspectLocalSnapshotDirectory({
      snapshotDirectory: mobileRoot,
      repositoryRoot,
      mobileDocumentsRoot: mobileRoot,
      cloudStorageRoot: join(root, "missing-cloud-root"),
    }, { runCommand: vi.fn() })).rejects.toThrow("同期folder");

    for (const options of ["apfs, nobrowse", "ext4, local"]) {
      await expect(inspectLocalSnapshotDirectory({
        snapshotDirectory: safeRoot,
        repositoryRoot,
        mobileDocumentsRoot: mobileRoot,
        cloudStorageRoot: join(root, "missing-cloud-root"),
      }, {
        runCommand: async () => ({
          exitCode: 0,
          stdout: `/dev/disk1 on / (apfs, local)\n/dev/test on ${resolvedSafeRoot} (${options})`,
        }),
      })).rejects.toThrow("local APFS");
    }

    await chmod(safeRoot, 0o770);
    await expect(inspectLocalSnapshotDirectory({
      snapshotDirectory: safeRoot,
      repositoryRoot,
      mobileDocumentsRoot: mobileRoot,
      cloudStorageRoot: join(root, "missing-cloud-root"),
    }, { runCommand: vi.fn() })).rejects.toThrow("group/world書込み不可");
  });
});

describe("snapshot Keychain provisioning", () => {
  it("存在確認はKeychain値をBufferで検証し、直後にzeroizeする", async () => {
    const requests: LocalCommandRequest[] = [];
    const rawKeychainOutput = Buffer.from(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=\n",
      "ascii",
    );
    const result = await inspectSnapshotKeychainEntry({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
    }, {
      runCommand: async (request) => {
        requests.push(request);
        return { exitCode: 0, stdout: rawKeychainOutput };
      },
    });

    expect(result).toEqual({ exists: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].args).toContain("-w");
    expect(requests[0].sensitiveOutput).toBe(true);
    expect(requests[0].discardOutput).toBeUndefined();
    expect(requests[0].stdin).toBeUndefined();
    expect(rawKeychainOutput.every((value) => value === 0)).toBe(true);
  });

  it("不正・非canonical・32-byte以外のKeychain値を拒否してraw Bufferをzeroizeする", async () => {
    const invalidValues = [
      Buffer.from("not-base64\n", "ascii"),
      Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=\n", "ascii"),
      Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \n", "ascii"),
      Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\n", "ascii"),
    ];

    for (const raw of invalidValues) {
      await expect(inspectSnapshotKeychainEntry({
        projectId: PROJECT_ID,
        keyId: KEY_ID,
      }, {
        runCommand: async () => ({ exitCode: 0, stdout: raw }),
      })).rejects.toThrow("key形式が不正です");
      expect(raw.every((value) => value === 0)).toBe(true);
    }
  });

  it("既存entryを上書きせずadd commandを呼ばない", async () => {
    const requests: LocalCommandRequest[] = [];
    const existing = Buffer.from(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=\n",
      "ascii",
    );
    const command = vi.fn(async (request: LocalCommandRequest) => {
      requests.push(request);
      return { exitCode: 0, stdout: existing };
    });

    await expect(createSnapshotKeychainEntry({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
    }, { runCommand: command })).rejects.toThrow("上書きしません");
    expect(command).toHaveBeenCalledTimes(1);
    expect(requests[0].args[0]).toBe("find-generic-password");
    expect(existing.every((value) => value === 0)).toBe(true);
  });

  it("32-byte keyをcanonical Base64のstdinだけへ渡し、Buffer read-back後にzeroizeする", async () => {
    const generatedKey = Buffer.alloc(32, 7);
    const originalKey = Buffer.from(generatedKey);
    const expectedEncoded = Buffer.from(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      "ascii",
    );
    const requests: Array<{
      args: readonly string[];
      stdinSnapshot?: Buffer;
      discardOutput?: boolean;
      sensitiveOutput?: boolean;
    }> = [];
    let passedStdin: Buffer | undefined;
    let readbackOutput: Buffer | undefined;
    let findCount = 0;
    let stored = Buffer.alloc(0);
    const command = vi.fn(async (request: LocalCommandRequest) => {
      requests.push({
        args: [...request.args],
        stdinSnapshot: request.stdin ? Buffer.from(request.stdin) : undefined,
        discardOutput: request.discardOutput,
        sensitiveOutput: request.sensitiveOutput,
      });
      if (request.args[0] === "find-generic-password") {
        findCount += 1;
        if (findCount === 1) return { exitCode: 44, stdout: Buffer.alloc(0) };
        readbackOutput = Buffer.from(stored);
        return { exitCode: 0, stdout: readbackOutput };
      }
      passedStdin = request.stdin;
      if (!request.stdin) throw new Error("expected Keychain stdin");
      stored = Buffer.from(request.stdin.subarray(0, request.stdin.byteLength - 1));
      return { exitCode: 0, stdout: "secret echo must be discarded" };
    });

    await expect(createSnapshotKeychainEntry({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
    }, {
      runCommand: command,
      randomBytes: () => generatedKey,
    })).resolves.toEqual({ created: true });

    const add = requests.find((request) => request.args[0] === "add-generic-password");
    expect(add).toBeDefined();
    expect(add!.args.at(-1)).toBe("-w");
    expect(add!.args).not.toContain("-U");
    expect(add!.stdinSnapshot).toEqual(Buffer.concat([expectedEncoded, Buffer.from([0x0a])]));
    expect(add!.args).not.toContain(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    );
    expect(add!.discardOutput).toBe(true);
    const findRequests = requests.filter(
      (request) => request.args[0] === "find-generic-password",
    );
    expect(findRequests).toHaveLength(2);
    expect(findRequests.every((request) => request.sensitiveOutput === true)).toBe(true);
    expect(generatedKey.every((value) => value === 0)).toBe(true);
    expect(passedStdin?.every((value) => value === 0)).toBe(true);
    expect(readbackOutput?.every((value) => value === 0)).toBe(true);
    requests.forEach((request) => request.stdinSnapshot?.fill(0));
    originalKey.fill(0);
    expectedEncoded.fill(0);
    stored.fill(0);
  });

  it("登録後read-backが異なる場合も生成keyとread Bufferをzeroizeする", async () => {
    const generatedKey = Buffer.alloc(32, 7);
    const mismatchedReadback = Buffer.from(
      "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=\n",
      "ascii",
    );
    let call = 0;
    const error = await capturedError(() => createSnapshotKeychainEntry({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
    }, {
      randomBytes: () => generatedKey,
      runCommand: async (request) => {
        call += 1;
        if (call === 1) return { exitCode: 44, stdout: Buffer.alloc(0) };
        if (request.args[0] === "add-generic-password") {
          return { exitCode: 0, stdout: "" };
        }
        return { exitCode: 0, stdout: mismatchedReadback };
      },
    }));

    expect(error.message).toBe("Keychain登録後のkey一致を確認できません");
    expect(generatedKey.every((value) => value === 0)).toBe(true);
    expect(mismatchedReadback.every((value) => value === 0)).toBe(true);
  });

  it("Keychain command失敗時もkeyをzeroizeし秘密をerrorへ出さない", async () => {
    const generatedKey = Buffer.alloc(32, 0xab);
    let call = 0;
    const error = await capturedError(() => createSnapshotKeychainEntry({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
    }, {
      randomBytes: () => generatedKey,
      runCommand: async () => {
        call += 1;
        return call === 1
          ? { exitCode: 44, stdout: Buffer.alloc(0) }
          : { exitCode: 1, stdout: "raw-secret-output" };
      },
    }));

    expect(error.message).toBe("snapshot keyをKeychainへ登録できません");
    expect(error.message).not.toContain("raw-secret-output");
    expect(generatedKey.every((value) => value === 0)).toBe(true);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function capturedError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected action to fail");
}
