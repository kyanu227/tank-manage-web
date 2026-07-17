import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnapshotEncryptionKey } from "./snapshot-key-provider";
import { snapshotKeychainIdentity } from "./snapshot-keychain-identity";

const ENABLED = process.platform === "darwin"
  && process.env.CUTOVER_KEYCHAIN_MACOS_INTEGRATION === "1";
const describeIntegration = ENABLED ? describe : describe.skip;

describeIntegration("macOS production Keychain write/read integration", () => {
  it("add→production read→duplicate拒否→元値保持→helper破棄後read→cleanupを完了する", async () => {
    const projectId = "okmarine-tankrental";
    const keyId = `integration-${randomUUID()}`;
    const identity = snapshotKeychainIdentity(projectId, keyId);
    const directory = mkdtempSync(join(tmpdir(), "cutover-keychain-integration-"));
    const helperScript = join(directory, "keychain-helper.exp");
    const firstKey = randomBytes(32);
    const secondKey = randomBytes(32);
    const firstEncoded = Buffer.from(firstKey.toString("base64"), "ascii");
    const secondEncoded = Buffer.from(secondKey.toString("base64"), "ascii");
    const isolatedHome = join(directory, "isolated-home");
    const originalHome = process.env.HOME;

    try {
      chmodSync(directory, 0o700);
      mkdirSync(isolatedHome, { mode: 0o700 });
      copyFileSync(join(import.meta.dirname, "keychain-generic-password.exp"), helperScript);
      chmodSync(helperScript, 0o500);

      const addedResult = runHelper(helperScript, identity.service, identity.account, firstEncoded);
      expect(addedResult.status).toBe(0);
      expect(addedResult.stdout).toHaveLength(0);
      expect(addedResult.stderr).toHaveLength(0);

      const firstRead = await loadSnapshotEncryptionKey({ projectId, keyId, source: "keychain" });
      expect(timingSafeEqual(firstRead, firstKey)).toBe(true);
      firstRead.fill(0);

      const duplicate = runHelper(helperScript, identity.service, identity.account, secondEncoded);
      expect(duplicate.error).toBeUndefined();
      expect(duplicate.signal).toBeNull();
      expect(duplicate.status).toBe(1);
      expect(duplicate.stdout).toHaveLength(0);
      expect(duplicate.stderr).toHaveLength(0);

      rmSync(helperScript);
      process.env.HOME = isolatedHome;
      const secondRead = await loadSnapshotEncryptionKey({ projectId, keyId, source: "keychain" });
      expect(timingSafeEqual(secondRead, firstKey)).toBe(true);
      secondRead.fill(0);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      const deleted = spawnSync("/usr/bin/security", [
        "delete-generic-password",
        "-s",
        identity.service,
        "-a",
        identity.account,
      ], { stdio: "ignore", timeout: 5_000 });
      expect([0, 44]).toContain(deleted.status);
      const remaining = spawnSync("/usr/bin/security", [
        "find-generic-password",
        "-s",
        identity.service,
        "-a",
        identity.account,
      ], { stdio: "ignore", timeout: 5_000 });
      expect(remaining.error).toBeUndefined();
      expect(remaining.signal).toBeNull();
      expect(remaining.status).toBe(44);
      firstKey.fill(0);
      secondKey.fill(0);
      firstEncoded.fill(0);
      secondEncoded.fill(0);
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    }
  }, 40_000);
});

function runHelper(
  helperScript: string,
  service: string,
  account: string,
  key: Buffer,
): ReturnType<typeof spawnSync> {
  return spawnSync(
    "/usr/bin/expect",
    ["-N", "-n", "-f", helperScript, "add-generic-password", service, account],
    {
      input: key,
      encoding: null,
      timeout: 25_000,
      maxBuffer: 4_096,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "test",
        HOME: process.env.HOME,
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        TMPDIR: process.env.TMPDIR,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
    },
  );
}
