import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  assertPinnedFirestoreRulesArtifact,
  normalizeFirestoreRulesSource,
  normalizedFirestoreRulesSha256,
  parseFirestoreRulesBaselineManifest,
  verifyLiveFirestoreRulesBaseline,
  type FirestoreRulesBaselineManifest,
} from "./firestore-rules-baseline";

const PROJECT_ID = "okmarine-tankrental";
const TOKEN = "unit-test-secret-rules-token";
const SOURCE = "rules_version = '2';\nservice cloud.firestore {}\n";
const RULESET_ID = "5e97d441-b926-473a-a983-b77e41293db4";
const RELEASE_NAME = `projects/${PROJECT_ID}/releases/cloud.firestore`;
const RULESET_NAME = `projects/${PROJECT_ID}/rulesets/${RULESET_ID}`;
const RELEASE_CREATE_TIME = "2026-03-11T07:36:20.560827Z";
const RELEASE_UPDATE_TIME = "2026-06-02T08:28:53.917518Z";
const RULESET_CREATE_TIME = "2026-06-02T08:28:52.433311Z";
const LIVE_RULES_SOURCE_FILE = "firestore.cutover-baseline.rules";

describe("Firestore Rules rollback baseline", () => {
  it("改行形式と末尾改行数だけを正規化する", () => {
    expect(normalizeFirestoreRulesSource("alpha")).toBe("alpha\n");
    expect(normalizeFirestoreRulesSource("alpha\n")).toBe("alpha\n");
    expect(normalizeFirestoreRulesSource("alpha\n\n")).toBe("alpha\n");
    expect(normalizeFirestoreRulesSource("alpha\r\nbeta\r\n")).toBe("alpha\nbeta\n");
    expect(normalizedFirestoreRulesSha256("alpha")).toBe(
      normalizedFirestoreRulesSha256("alpha\n\n"),
    );
    expect(normalizedFirestoreRulesSha256("alpha ")).not.toBe(
      normalizedFirestoreRulesSha256("alpha"),
    );
    expect(() => normalizeFirestoreRulesSource("alpha\rbeta")).toThrow("改行");
    expect(() => normalizeFirestoreRulesSource("")).toThrow("空");
  });

  it("repository baseline・manifest・pinned Git commitが一致する", async () => {
    const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const manifest = parseFirestoreRulesBaselineManifest(JSON.parse(await readFile(
      `${repositoryRoot}/firestore.cutover-baseline.manifest.json`,
      "utf8",
    )));
    const baselineSource = await readFile(
      `${repositoryRoot}/firestore.cutover-baseline.rules`,
      "utf8",
    );
    const gitSource = execFileSync(
      "git",
      ["show", `${manifest.gitCommit}:${manifest.pinnedGitRulesFile}`],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    expect(() => assertPinnedFirestoreRulesArtifact({
      manifest,
      baselineSource,
      gitSource,
    })).not.toThrow();
    expect(manifest.gitCommit).toBe("b7e853c8f38071937951b871cbe0e3281dd22876");
    expect(manifest.normalizedSha256).toBe(
      "6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8",
    );
    const baselineConfig = JSON.parse(await readFile(
      `${repositoryRoot}/firebase.cutover-baseline.json`,
      "utf8",
    )) as { firestore?: { rules?: unknown } };
    expect(baselineConfig.firestore?.rules).toBe(manifest.liveRulesSourceFile);
  });

  it("release GET→ruleset GET→release GETでstableなlive baselineを確認する", async () => {
    const fetchMock = successfulFetch();
    const result = await verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore`,
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets/${RULESET_ID}`,
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore`,
    ]);
    fetchMock.mock.calls.forEach(([, init]) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(init?.body).toBeUndefined();
    });
    expect(result).toMatchObject({
      mode: "pre-freeze-live-rules-baseline-verification",
      matched: true,
      projectId: PROJECT_ID,
      releaseId: "cloud.firestore",
      rulesetId: RULESET_ID,
      liveRulesSourceFile: LIVE_RULES_SOURCE_FILE,
      normalizedSha256: normalizedFirestoreRulesSha256(SOURCE),
    });
    expect(JSON.stringify(result)).not.toContain(SOURCE.trim());
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("data migration credentialをRules APIへ渡さずproviderも呼ばない", async () => {
    const dataTokenProvider = vi.fn(async () => "data-token-must-not-be-used");
    const input = verificationInput();
    const fetchMock = vi.fn();
    await expect(verifyLiveFirestoreRulesBaseline({
      ...input,
      rulesReaderCredential: {
        kind: "data_migration",
        accessTokenProvider: dataTokenProvider,
      } as unknown as typeof input.rulesReaderCredential,
    }, {
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow("Rules reader credential");
    expect(dataTokenProvider).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API本文のCRLFと余分な末尾改行だけでは誤判定しない", async () => {
    const apiSource = SOURCE.replaceAll("\n", "\r\n") + "\r\n";
    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: successfulFetch({ source: apiSource }) },
    )).resolves.toMatchObject({ matched: true });
  });

  it("live本文の不一致をfail closedにしstableなrelease metadata更新は許容する", async () => {
    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: successfulFetch({ source: `${SOURCE}// drift\n` }) },
    )).rejects.toThrow("pinned rollback baseline");

    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: successfulFetch({ releaseUpdateTime: "2026-06-02T08:29:00Z" }) },
    )).resolves.toMatchObject({
      matched: true,
      releaseUpdateTime: "2026-06-02T08:29:00Z",
    });

    const redeployedRulesetName = `projects/${PROJECT_ID}/rulesets/redeployed-same-source`;
    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: successfulFetch({ rulesetName: redeployedRulesetName }) },
    )).resolves.toMatchObject({
      matched: true,
      rulesetId: "redeployed-same-source",
    });
  });

  it("releaseがruleset取得中に変化した場合をfail closedにする", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(releaseResponse()))
      .mockResolvedValueOnce(jsonResponse(rulesetResponse()))
      .mockResolvedValueOnce(jsonResponse(releaseResponse({
        updateTime: "2026-06-02T08:29:00Z",
      })));
    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: fetchMock },
    )).rejects.toThrow("検証中に変更");
  });

  it("別project resourceとambiguous sourceを拒否する", async () => {
    const otherRuleset = "projects/other-tank-project/rulesets/unsafe-ruleset";
    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: vi.fn().mockResolvedValue(jsonResponse(releaseResponse({
        rulesetName: otherRuleset,
      }))) },
    )).rejects.toThrow("expected project");

    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: successfulFetch({ files: [
        { name: LIVE_RULES_SOURCE_FILE, content: SOURCE },
        { name: "other.rules", content: SOURCE },
      ] }) },
    )).rejects.toThrow("一意に特定");
  });

  it("manifest v1を拒否し一意なlive source filename変更は本文一致なら許容する", async () => {
    const current = manifest();
    const legacy = {
      ...current,
      version: 1,
      rulesFile: "firestore.rules",
    } as Record<string, unknown>;
    delete legacy.pinnedGitRulesFile;
    delete legacy.liveRulesSourceFile;
    expect(() => parseFirestoreRulesBaselineManifest(legacy)).toThrow("field");

    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: successfulFetch({ files: [
        { name: "firestore.rules", content: SOURCE },
      ] }) },
    )).resolves.toMatchObject({
      matched: true,
      liveRulesSourceFile: "firestore.rules",
    });
  });

  it("HTTP error body・source・tokenを例外へ含めない", async () => {
    const secretBody = `${SOURCE}\nprivate=${TOKEN}`;
    const error = await capturedError(() => verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: vi.fn(async () => new Response(secretBody, { status: 403 })) },
    ));
    expect(error.message).toContain("status=403");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(SOURCE.trim());

    const fetchError = await capturedError(() => verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: vi.fn(async () => { throw new Error(secretBody); }) },
    ));
    expect(fetchError.message).toBe("Firebase Rules APIからlive Rulesを取得できません");
    expect(fetchError.message).not.toContain(TOKEN);
  });

  it("invalid JSONとresponse size超過をsource非表示で拒否する", async () => {
    const invalid = await capturedError(() => verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: vi.fn(async () => new Response(`${SOURCE}${TOKEN}`)) },
    ));
    expect(invalid.message).toBe("Firebase Rules API responseが不正です");
    expect(invalid.message).not.toContain(TOKEN);

    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      {
        fetch: vi.fn(async () => new Response(JSON.stringify(releaseResponse()))),
        maxResponseBytes: 10,
      },
    )).rejects.toThrow("上限");
  });

  it("baseline fileまたはGit sourceのmanifest不一致をAPI前に拒否する", async () => {
    const fetchMock = vi.fn();
    await expect(verifyLiveFirestoreRulesBaseline(
      { ...verificationInput(), gitSource: `${SOURCE}// changed\n` },
      { fetch: fetchMock as unknown as typeof fetch },
    )).rejects.toThrow("pinned Git commit");
    expect(fetchMock).not.toHaveBeenCalled();

    expect(() => assertPinnedFirestoreRulesArtifact({
      manifest: manifest(),
      baselineSource: SOURCE,
      gitSource: `${SOURCE}\n`,
    })).toThrow("pinned Git commit");
  });

  it("content-lengthの負数をresponse読取り前に拒否する", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(releaseResponse()), {
      headers: { "Content-Length": "-1" },
    }));
    await expect(verifyLiveFirestoreRulesBaseline(
      verificationInput(),
      { fetch: fetchMock },
    )).rejects.toThrow("上限");
  });
});

function verificationInput() {
  return {
    projectId: PROJECT_ID,
    rulesReaderCredential: {
      kind: "rules_reader" as const,
      accessTokenProvider: vi.fn(async () => TOKEN),
    },
    manifest: manifest(),
    baselineSource: SOURCE,
    gitSource: SOURCE,
  };
}

function manifest(): FirestoreRulesBaselineManifest {
  const normalized = normalizeFirestoreRulesSource(SOURCE);
  return {
    version: 2,
    projectId: PROJECT_ID,
    releaseName: RELEASE_NAME,
    releaseCreateTime: RELEASE_CREATE_TIME,
    releaseUpdateTime: RELEASE_UPDATE_TIME,
    rulesetName: RULESET_NAME,
    rulesetCreateTime: RULESET_CREATE_TIME,
    pinnedGitRulesFile: "firestore.rules",
    liveRulesSourceFile: LIVE_RULES_SOURCE_FILE,
    gitCommit: "b7e853c8f38071937951b871cbe0e3281dd22876",
    normalizedSha256: createHash("sha256").update(normalized, "utf8").digest("hex"),
    normalizedBytes: Buffer.byteLength(normalized, "utf8"),
  };
}

function successfulFetch(options: {
  source?: string;
  releaseUpdateTime?: string;
  rulesetName?: string;
  files?: Array<{ name: string; content: string }>;
} = {}) {
  const release = releaseResponse({
    rulesetName: options.rulesetName,
    updateTime: options.releaseUpdateTime,
  });
  return vi.fn()
    .mockResolvedValueOnce(jsonResponse(release))
    .mockResolvedValueOnce(jsonResponse(rulesetResponse({
      rulesetName: options.rulesetName,
      source: options.source,
      files: options.files,
    })))
    .mockResolvedValueOnce(jsonResponse(release));
}

function releaseResponse(overrides: {
  rulesetName?: string;
  updateTime?: string;
} = {}) {
  return {
    name: RELEASE_NAME,
    rulesetName: overrides.rulesetName ?? RULESET_NAME,
    createTime: RELEASE_CREATE_TIME,
    updateTime: overrides.updateTime ?? RELEASE_UPDATE_TIME,
  };
}

function rulesetResponse(options: {
  rulesetName?: string;
  source?: string;
  files?: Array<{ name: string; content: string }>;
} = {}) {
  return {
    name: options.rulesetName ?? RULESET_NAME,
    createTime: RULESET_CREATE_TIME,
    source: {
      files: options.files ?? [{ name: LIVE_RULES_SOURCE_FILE, content: options.source ?? SOURCE }],
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function capturedError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected action to reject");
}
