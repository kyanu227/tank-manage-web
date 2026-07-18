import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PRODUCTION_CUTOVER_DATA_PRINCIPAL,
  PRODUCTION_CUTOVER_DATABASE_ID,
  PRODUCTION_CUTOVER_DATABASE_UID,
  PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
  PRODUCTION_RESET_CONFIRMATION,
  PRODUCTION_RESTORE_CONFIRMATION,
} from "./production-execution-contract";
import { CUTOVER_PROJECT_ID } from "./infra-contract";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TSX_CLI = require.resolve("tsx/cli");

describe("production cutover .ts entrypoints", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let homeDirectory: string;
  let headCommit: string;
  let tripwirePath: string;

  beforeAll(() => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "cutover-entrypoint-"));
    repositoryRoot = join(temporaryRoot, "repository");
    homeDirectory = join(temporaryRoot, "home");
    mkdirSync(repositoryRoot);
    mkdirSync(homeDirectory);
    tripwirePath = join(repositoryRoot, "network-tripwire.cjs");
    writeFileSync(tripwirePath, networkTripwireSource(), { mode: 0o600 });
    git(["init", "--quiet"]);
    git(["add", "network-tripwire.cjs"]);
    git([
      "-c", "user.name=Cutover Test",
      "-c", "user.email=cutover-test@example.invalid",
      "commit", "--quiet", "-m", "test fixture",
    ]);
    headCommit = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/remotes/origin/main", headCommit]);
  });

  afterAll(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it.each([
    [
      "reset",
      "reset-transition-cutover-snapshot.ts",
      PRODUCTION_RESET_CONFIRMATION,
      "RESET_EXECUTION_GATE_FAILED",
    ],
    [
      "restore",
      "restore-transition-cutover-snapshot.ts",
      PRODUCTION_RESTORE_CONFIRMATION,
      "PRODUCTION_CUTOVER_EXECUTE_DISABLED",
    ],
  ] as const)(
    "%sの実entrypointはcutover完了後にsnapshot読取前で停止する",
    (operation, entrypointName, confirmation, expectedCode) => {
      const markerPath = join(temporaryRoot, `${operation}-network-accessed`);
      const snapshotPath = join(temporaryRoot, `${operation}-missing.snapshot.enc.json`);
      const env = { ...process.env };
      delete env.FIRESTORE_EMULATOR_HOST;
      delete env.GOOGLE_APPLICATION_CREDENTIALS;
      env.HOME = homeDirectory;
      env.CLOUDSDK_CONFIG = join(homeDirectory, ".config", "gcloud");
      env.CUTOVER_NETWORK_MARKER = markerPath;
      env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require=${tripwirePath}`.trim();

      const result = spawnSync(process.execPath, [
        TSX_CLI,
        join(ROOT, "scripts", entrypointName),
        `--project=${CUTOVER_PROJECT_ID}`,
        `--database=${PRODUCTION_CUTOVER_DATABASE_ID}`,
        `--expected-database-uid=${PRODUCTION_CUTOVER_DATABASE_UID}`,
        `--expected-main-commit=${headCommit}`,
        "--key-id=entrypoint-regression-test",
        "--snapshot-storage-mode=local_encrypted",
        `--expected-data-principal=${PRODUCTION_CUTOVER_DATA_PRINCIPAL}`,
        `--snapshot=${snapshotPath}`,
        "--execute",
        `--confirm=${confirmation}`,
        `--operator-principal=${PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL}`,
        "--expected-snapshot-id=entrypoint-regression-test",
        `--expected-snapshot-payload-sha256=${"b".repeat(64)}`,
        `--expected-source-census-sha256=${"c".repeat(64)}`,
        `--expected-reset-plan-sha256=${"d".repeat(64)}`,
      ], {
        cwd: repositoryRoot,
        env,
        encoding: "utf8",
        timeout: 30_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(
        `cutover command failed (${expectedCode}); sensitive details were suppressed`,
      );
      expect(result.stderr).not.toContain(snapshotPath);
      expect(result.stderr).not.toContain(PRODUCTION_CUTOVER_DATA_PRINCIPAL);
      expect(existsSync(markerPath)).toBe(false);
    },
    30_000,
  );

  it("production entrypointを単一CommonJS module graphになる.tsとして固定する", () => {
    const resetPath = join(ROOT, "scripts/reset-transition-cutover-snapshot.ts");
    const restorePath = join(ROOT, "scripts/restore-transition-cutover-snapshot.ts");
    expect(existsSync(resetPath)).toBe(true);
    expect(existsSync(restorePath)).toBe(true);
    expect(existsSync(`${resetPath.slice(0, -3)}.mts`)).toBe(false);
    expect(existsSync(`${restorePath.slice(0, -3)}.mts`)).toBe(false);
    expect(readFileSync(resetPath, "utf8")).toContain("authorizeResetServiceExecution");
    expect(readFileSync(restorePath, "utf8")).toContain("authorizeRestoreServiceExecution");
  });

  function git(args: string[]): string {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
});

function networkTripwireSource(): string {
  return String.raw`
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
function rejectNetworkAccess() {
  fs.writeFileSync(process.env.CUTOVER_NETWORK_MARKER, "blocked\n", { flag: "a" });
  throw new Error("network access is forbidden in the cutover entrypoint test");
}
globalThis.fetch = rejectNetworkAccess;
http.request = rejectNetworkAccess;
http.get = rejectNetworkAccess;
https.request = rejectNetworkAccess;
https.get = rejectNetworkAccess;
http2.connect = rejectNetworkAccess;
`;
}
