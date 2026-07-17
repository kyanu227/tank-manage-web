import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_COMMAND_TIMEOUT_MS } from "./local-cutover-environment";

const SOURCE_PATH = join(import.meta.dirname, "keychain-generic-password.exp");
const describeMacOs = process.platform === "darwin" ? describe : describe.skip;

describeMacOs("macOS Keychain Expect helper contract", () => {
  it("system securityだけをPTY起動し、非表示の二重入力と非更新を固定する", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    expect(source).toContain("log_user 0");
    expect(source).toContain("exp_internal 0");
    expect(source).toContain("read stdin 44");
    expect(source).toContain("/usr/bin/security add-generic-password");
    expect(source).toContain("-T /usr/bin/security");
    expect(source).toContain('-exact "password data for new item: " {}');
    expect(source).toContain('-exact "retype password for new item: " {}');
    expect(source.match(/timeout \{ fail_closed \}/gu)).toHaveLength(3);
    expect(source.match(/eof \{ fail_closed \}/gu)).toHaveLength(2);
    expect(source).toContain("catch { wait }");
    expect(source.match(/send -- "\$key\\r"/gu)).toHaveLength(2);
    expect(source).not.toContain(" -U");
    expect(source).not.toContain("puts ");

    const phaseTimeoutSeconds = Number(source.match(/^set timeout (\d+)$/mu)?.[1]);
    const phaseCount = source.match(/timeout \{ fail_closed \}/gu)?.length ?? 0;
    expect(phaseTimeoutSeconds * phaseCount * 1_000)
      .toBeLessThan(LOCAL_COMMAND_TIMEOUT_MS - 5_000);
  });

  it("empty・43/45 bytes・改行・非canonical入力を出力せず拒否する", () => {
    const canonical = Buffer.from(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      "ascii",
    );
    const invalidInputs = [
      Buffer.alloc(0),
      Buffer.alloc(43, 0x41),
      Buffer.alloc(45, 0x41),
      Buffer.concat([canonical, Buffer.from([0x0a])]),
      Buffer.from("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwd=", "ascii"),
    ];

    for (const input of invalidInputs) {
      const result = runHelper("tank-manage-cutover", "okmarine-tankrental:invalid-input-test", input);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toHaveLength(0);
      expect(result.stderr).toHaveLength(0);
      input.fill(0);
    }
    canonical.fill(0);
  });

  it("固定service以外をcanonical入力でも拒否する", () => {
    const input = Buffer.from(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      "ascii",
    );
    const result = runHelper("unexpected-service", "okmarine-tankrental:invalid-service-test", input);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
    input.fill(0);
  });

  it("system・user Expect startup fileを読み込まない", () => {
    const home = mkdtempSync(join(tmpdir(), "cutover-expect-home-"));
    const marker = join(home, "startup-loaded");
    try {
      writeFileSync(join(home, ".expect.rc"), [
        "set marker [open [file join $env(HOME) startup-loaded] w]",
        "puts $marker loaded",
        "close $marker",
      ].join("\n"));
      const result = runHelper(
        "unexpected-service",
        "okmarine-tankrental:startup-file-test",
        Buffer.alloc(0),
        home,
      );
      expect(result.status).toBe(1);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

function runHelper(service: string, account: string, key: Buffer, home?: string) {
  return spawnSync(
    "/usr/bin/expect",
    ["-N", "-n", "-f", SOURCE_PATH, "add-generic-password", service, account],
    {
      input: key,
      encoding: null,
      timeout: 5_000,
      maxBuffer: 4_096,
      env: home === undefined ? undefined : {
        NODE_ENV: process.env.NODE_ENV ?? "test",
        HOME: home,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
    },
  );
}
