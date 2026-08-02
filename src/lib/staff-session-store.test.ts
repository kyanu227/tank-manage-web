import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTypeScriptSource,
} from "@/features/staff-dashboard/testing/typescript-source";
import {
  getStaffLocale,
  getStaffSession,
  requireStaffIdentity,
  staffSessionToOperationActor,
  subscribeStaffSession,
  updateStoredStaffSessionLocale,
} from "@/lib/staff-session-store";

const STORE_PATH = "src/lib/staff-session-store.ts";
const STORAGE_KEY = "staffSession";
let storedValues: Map<string, string>;

describe("staff session store", () => {
  beforeEach(() => {
    storedValues = new Map<string, string>();
    const eventTarget = new EventTarget();

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storedValues.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storedValues.set(key, value);
      }),
    });
    vi.stubGlobal(
      "addEventListener",
      eventTarget.addEventListener.bind(eventTarget),
    );
    vi.stubGlobal(
      "removeEventListener",
      eventTarget.removeEventListener.bind(eventTarget),
    );
    vi.stubGlobal("dispatchEvent", eventTarget.dispatchEvent.bind(eventTarget));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Reactをimportしない", () => {
    const sourceFile = readTypeScriptSource(STORE_PATH);
    const importedModules = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .map((statement) =>
        (statement.moduleSpecifier as ts.StringLiteral).text
      );

    expect(importedModules).not.toContain("react");
    expect(importedModules).not.toContain("react-dom");
  });

  it("sessionがない場合はrequireStaffIdentityがfail-closedでthrowする", () => {
    expect(() => requireStaffIdentity()).toThrow(
      "スタッフIDを取得できませんでした。再ログインしてください。",
    );
  });

  it("不正なlocaleを現行どおりjaへ正規化する", () => {
    storedValues.set(
      STORAGE_KEY,
      JSON.stringify({ name: "海", locale: "invalid" }),
    );

    expect(getStaffLocale()).toBe("ja");
    expect(getStaffSession()?.locale).toBe("ja");
  });

  it("staff sessionを現行と同じoperation actorへ変換する", () => {
    expect(staffSessionToOperationActor({
      id: " staff-001 ",
      name: " 海 ",
      email: " staff@example.com ",
      role: " worker ",
      rank: " silver ",
      locale: "ja",
    })).toStrictEqual({
      staffId: "staff-001",
      staffName: "海",
      staffEmail: "staff@example.com",
      role: "worker",
      rank: "silver",
    });
  });

  it("locale更新を保存して購読者へ通知する", () => {
    storedValues.set(
      STORAGE_KEY,
      JSON.stringify({ id: "staff-001", name: "海", locale: "ja" }),
    );
    const subscriber = vi.fn();
    const unsubscribe = subscribeStaffSession(subscriber);

    updateStoredStaffSessionLocale("en");

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(getStaffSession()).toStrictEqual({
      name: "海",
      id: "staff-001",
      locale: "en",
    });

    unsubscribe();
  });

  it("現行と同じキー・プロパティ順・正規化済みJSONで保存する", () => {
    storedValues.set(
      STORAGE_KEY,
      JSON.stringify({
        locale: "ja",
        rank: " silver ",
        role: " worker ",
        email: " staff@example.com ",
        name: " 海 ",
        id: " staff-001 ",
        ignored: "value",
      }),
    );

    updateStoredStaffSessionLocale("en");

    expect(localStorage.setItem).toHaveBeenCalledWith(
      "staffSession",
      "{\"name\":\"海\",\"id\":\"staff-001\",\"email\":\"staff@example.com\",\"role\":\"worker\",\"rank\":\"silver\",\"locale\":\"en\"}",
    );
  });
});
