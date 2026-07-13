import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { FirestoreRestClient } from "./firestore-rest-client";
import type { SnapshotKeySource } from "./snapshot-key-provider";

export type SnapshotCommonArguments = {
  projectId: string;
  databaseId: string;
  databaseUid: string;
  mainCommit: string;
  keyId: string;
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
    "--test-key-stdin",
    ...additionalNames,
  ]);
  const seenNames = new Set<string>();
  argv.forEach((argument) => {
    const name = argument.split("=", 1)[0];
    if (!knownNames.has(name)) throw new Error(`未知の引数です: ${argument}`);
    if (seenNames.has(name)) throw new Error(`引数を重複指定できません: ${name}`);
    seenNames.add(name);
  });

  const projectId = argumentValue(argv, "--project");
  const databaseId = argumentValue(argv, "--database");
  const databaseUid = argumentValue(argv, "--expected-database-uid");
  const mainCommit = argumentValue(argv, "--expected-main-commit");
  const keyId = argumentValue(argv, "--key-id");
  if (!projectId) throw new Error("--project=<explicit-project-id> は必須です");
  if (!databaseId) throw new Error("--database=<explicit-database-id> は必須です");
  if (!databaseUid) throw new Error("--expected-database-uid=<uid> は必須です");
  if (!/^[0-9a-f]{40}$/.test(mainCommit)) {
    throw new Error("--expected-main-commitには40文字のGit SHAが必要です");
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(keyId)) {
    throw new Error("--key-idは英数字・._-だけで指定してください");
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
    emulatorHost,
    keySource: testKeyStdin ? "test-stdin" : "keychain",
    repositoryRoot,
  };
}

export function createSnapshotRestClient(args: SnapshotCommonArguments): FirestoreRestClient {
  return new FirestoreRestClient({
    projectId: args.projectId,
    databaseId: args.databaseId,
    emulatorHost: args.emulatorHost,
  });
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

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
