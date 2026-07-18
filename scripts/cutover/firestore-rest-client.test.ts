import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FirestoreRestClient,
  serializeFirestoreRestBody,
} from "./firestore-rest-client";
import {
  PRODUCTION_CUTOVER_DATA_PRINCIPAL,
} from "./production-execution-contract";

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
    await expect(client.commit([{
      delete: "projects/okmarine-tankrental/databases/(default)/documents/tanks/T-001",
    }])).rejects.toThrow("authorization");
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
});
