import { describe, expect, it } from "vitest";
import {
  FirestoreRestClient,
  serializeFirestoreRestBody,
} from "./firestore-rest-client";

describe("Firestore REST client safety", () => {
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
});
