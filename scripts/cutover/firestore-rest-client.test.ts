import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FirestoreRestClient,
  serializeFirestoreRestBody,
} from "./firestore-rest-client";
import {
  PRODUCTION_CUTOVER_DATA_PRINCIPAL,
} from "./production-execution-contract";
import { safeCutoverErrorCode } from "./cutover-diagnostic-error";

const EMULATOR_WRITE = {
  delete: "projects/demo-cutover/databases/(default)/documents/tanks/T-001",
};

describe("Firestore REST client safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("request serializerはFirestore doubleValue=-0を保持する", () => {
    const body = serializeFirestoreRestBody({
      writes: [{
        update: {
          name: "projects/demo-cutover/databases/(default)/documents/tanks/T-001",
          fields: { negativeZero: { doubleValue: -0 } },
        },
      }],
    });
    expect(body).toContain('"doubleValue":-0');
    const parsed = JSON.parse(body) as {
      writes: Array<{ update: { fields: { negativeZero: { doubleValue: number } } } }>;
    };
    expect(Object.is(parsed.writes[0].update.fields.negativeZero.doubleValue, -0)).toBe(true);
  });

  it("Emulator hostはloopbackだけを許可する", () => {
    expect(() => new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "127.0.0.1:8080",
    })).not.toThrow();
    expect(() => new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "localhost:8080",
    })).not.toThrow();
    expect(() => new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "192.168.1.10:8080",
    })).toThrow("loopback");
    expect(() => new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "firestore.example.com:8080",
    })).toThrow("loopback");
  });

  it("cutover用clientの本番commitを下位境界でも拒否する", async () => {
    const client = new FirestoreRestClient({
      projectId: "okmarine-tankrental",
      databaseId: "(default)",
      accessTokenProvider: async () => "unused-test-token",
      dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    });
    const error = await client.commit([{
      delete: "projects/okmarine-tankrental/databases/(default)/documents/tanks/T-001",
    }]).catch((caught) => caught);
    expect(safeCutoverErrorCode(error)).toBe("RESET_AUTHORIZATION_FAILED");
  });

  it("本番readでも暗黙ADCへfallbackせず明示providerを必須にする", () => {
    expect(() => new FirestoreRestClient({
      projectId: "okmarine-tankrental",
      databaseId: "(default)",
    })).toThrow("検証済みaccess token provider");
  });

  it("本番clientは検証済みdata principalも必須にする", () => {
    expect(() => new FirestoreRestClient({
      projectId: "okmarine-tankrental",
      databaseId: "(default)",
      accessTokenProvider: async () => "unused-test-token",
    })).toThrow("data principal");
  });

  it("不正な本番response本文をerrorへ再掲しない", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "sensitive-customer-document",
      { status: 200 },
    ));
    const client = new FirestoreRestClient({
      projectId: "okmarine-tankrental",
      databaseId: "(default)",
      accessTokenProvider: async () => "unused-test-token",
      dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    });
    await expect(client.verifyDatabaseUid("expected-uid"))
      .rejects.toThrow("Firestore REST responseがJSONではありません");
    await expect(client.verifyDatabaseUid("expected-uid"))
      .rejects.not.toThrow("sensitive-customer-document");
  });

  it("data credential token取得失敗を本文なしのsafe codeへ分類する", async () => {
    const client = new FirestoreRestClient({
      projectId: "okmarine-tankrental",
      databaseId: "(default)",
      accessTokenProvider: async () => {
        throw new Error("sensitive-token-provider-detail");
      },
      dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    });
    const error = await client.verifyDatabaseUid("expected-uid").catch((caught) => caught);
    expect(safeCutoverErrorCode(error)).toBe("DATA_CREDENTIAL_TOKEN_FAILED");
  });

  it.each([
    [403, "FIRESTORE_COMMIT_HTTP_4XX"],
    [503, "FIRESTORE_COMMIT_HTTP_5XX"],
    [302, "FIRESTORE_COMMIT_HTTP_OTHER"],
  ] as const)("commit HTTP %sをsafe codeへ分類しresponse本文を保持しない", async (
    status,
    expectedCode,
  ) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "sensitive-http-error-body",
      { status },
    ));
    const client = new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "127.0.0.1:8080",
    });
    const error = await client.commit([EMULATOR_WRITE]).catch((caught) => caught);
    expect(safeCutoverErrorCode(error)).toBe(expectedCode);
    expect(String(error)).not.toContain("sensitive-http-error-body");
  });

  it("commit transport失敗をambiguous safe codeへ分類する", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sensitive-network-detail"));
    const client = new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "127.0.0.1:8080",
    });
    const error = await client.commit([EMULATOR_WRITE]).catch((caught) => caught);
    expect(safeCutoverErrorCode(error)).toBe("FIRESTORE_COMMIT_TRANSPORT_AMBIGUOUS");
  });

  it("commit response body読取失敗もtransport ambiguousへ分類する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockRejectedValue(new Error("sensitive-body-stream-detail")),
    } as unknown as Response);
    const client = new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "127.0.0.1:8080",
    });
    const error = await client.commit([EMULATOR_WRITE]).catch((caught) => caught);
    expect(safeCutoverErrorCode(error)).toBe("FIRESTORE_COMMIT_TRANSPORT_AMBIGUOUS");
    expect(String(error)).not.toContain("sensitive-body-stream-detail");
  });

  it("成功statusの不正commit responseをsafe codeへ分類し本文を保持しない", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "sensitive-invalid-json",
      { status: 200 },
    ));
    const client = new FirestoreRestClient({
      projectId: "demo-cutover",
      databaseId: "(default)",
      emulatorHost: "127.0.0.1:8080",
    });
    const error = await client.commit([EMULATOR_WRITE]).catch((caught) => caught);
    expect(safeCutoverErrorCode(error)).toBe("FIRESTORE_COMMIT_RESPONSE_INVALID");
    expect(String(error)).not.toContain("sensitive-invalid-json");
  });
});
