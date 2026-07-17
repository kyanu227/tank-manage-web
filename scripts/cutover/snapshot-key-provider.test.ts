import { describe, expect, it, vi } from "vitest";
import { loadSnapshotEncryptionKey } from "./snapshot-key-provider";
import type { LocalCommandRequest } from "./local-cutover-environment";

const PROJECT_ID = "okmarine-tankrental";
const KEY_ID = "transition-key-provider-test";

describe("snapshot Keychain provider", () => {
  it("production keyを文字列化せずsensitive Bufferから読取りraw outputをzeroizeする", async () => {
    const raw = Buffer.from(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=\n",
      "ascii",
    );
    const requestLog: LocalCommandRequest[] = [];
    const runCommand = vi.fn(async (request: LocalCommandRequest) => {
      requestLog.push(request);
      return { exitCode: 0, stdout: raw };
    });

    const key = await loadSnapshotEncryptionKey({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
      source: "keychain",
    }, { runCommand, platform: "darwin" });

    expect(key).toEqual(Buffer.alloc(32, 7));
    expect(raw.every((value) => value === 0)).toBe(true);
    expect(requestLog).toHaveLength(1);
    expect(requestLog[0]).toMatchObject({
      executable: "/usr/bin/security",
      sensitiveOutput: true,
    });
    expect(requestLog[0].args).not.toContain(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    );
    key.fill(0);
  });

  it("不正なKeychain値を拒否しraw Bufferとerrorへ秘密を残さない", async () => {
    const canary = Buffer.from("test-secret-canary\n", "ascii");
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: canary }));

    const error = await capturedError(() => loadSnapshotEncryptionKey({
      projectId: PROJECT_ID,
      keyId: KEY_ID,
      source: "keychain",
    }, { runCommand, platform: "darwin" }));

    expect(error.message).toContain("Keychainからsnapshot keyを取得できません");
    expect(error.message).not.toContain("test-secret-canary");
    expect(canary.every((value) => value === 0)).toBe(true);
  });
});

async function capturedError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected action to fail");
}
