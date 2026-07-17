import { describe, expect, it } from "vitest";
import {
  assertFirestoreCommitAllowed,
  assertResetCliExecutionAllowed,
  assertResetServiceExecutionAllowed,
  assertRestoreCliExecutionAllowed,
  assertRestoreServiceExecutionAllowed,
  probeProductionExecuteGatesClosed,
} from "./production-execute-gates";

describe("production cutover execute gates", () => {
  it("CLI・service・lower RESTの5境界をproduction条件で拒否する", () => {
    expect(probeProductionExecuteGatesClosed()).toBe(true);
    [
      () => assertResetCliExecutionAllowed({ execute: true }),
      () => assertRestoreCliExecutionAllowed({ execute: true }),
      () => assertResetServiceExecutionAllowed(),
      () => assertRestoreServiceExecutionAllowed(),
      () => assertFirestoreCommitAllowed(),
    ].forEach((probe) => expect(probe).toThrow("最終production execute解放PRまで無効"));
  });

  it("dry-runとEmulatorだけを通す", () => {
    expect(() => assertResetCliExecutionAllowed({ execute: false })).not.toThrow();
    expect(() => assertRestoreCliExecutionAllowed({ execute: true, emulatorHost: "127.0.0.1:8080" }))
      .not.toThrow();
    expect(() => assertResetServiceExecutionAllowed("127.0.0.1:8080")).not.toThrow();
    expect(() => assertRestoreServiceExecutionAllowed("127.0.0.1:8080")).not.toThrow();
    expect(() => assertFirestoreCommitAllowed("127.0.0.1:8080")).not.toThrow();
  });
});
