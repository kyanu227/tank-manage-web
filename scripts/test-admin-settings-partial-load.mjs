import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAdminSystemNotificationSettings,
} from "../src/lib/firebase/admin-notification-settings-load-state.ts";
import {
  allSettingsSectionsLoaded,
  assertSettingsSectionsLoaded,
  loadIndependentSettingsSections,
} from "../src/lib/settings-section-load.ts";

const notifySettings = {
  emails: ["ops@example.com"],
  alertMonths: 4,
  validityYears: 5,
};
const lineConfigs = [{ uid: "line-1" }];

test("notify成功 / LINE成功では両方を保持して保存可能", async () => {
  const [notify, line] = await loadIndependentSettingsSections(
    async () => notifySettings,
    async () => lineConfigs,
  );

  assert.deepEqual(notify, { status: "loaded", value: notifySettings });
  assert.deepEqual(line, { status: "loaded", value: lineConfigs });
  assert.equal(allSettingsSectionsLoaded(notify, line), true);
});

test("notify成功 / LINE失敗ではnotifyだけを保持して保存不可", async () => {
  const lineError = new Error("LINE read failed");
  const [notify, line] = await loadIndependentSettingsSections(
    async () => notifySettings,
    async () => { throw lineError; },
  );

  assert.deepEqual(notify, { status: "loaded", value: notifySettings });
  assert.equal(line.status, "error");
  if (line.status === "error") assert.equal(line.error, lineError);
  assert.equal(allSettingsSectionsLoaded(notify, line), false);
});

test("notify失敗 / LINE成功ではLINEだけを保持して保存不可", async () => {
  const notifyError = new Error("notify read failed");
  const [notify, line] = await loadIndependentSettingsSections(
    async () => { throw notifyError; },
    async () => lineConfigs,
  );

  assert.equal(notify.status, "error");
  if (notify.status === "error") assert.equal(notify.error, notifyError);
  assert.deepEqual(line, { status: "loaded", value: lineConfigs });
  assert.equal(allSettingsSectionsLoaded(notify, line), false);
});

test("両方失敗では両領域をerrorとして保存不可", async () => {
  const [notify, line] = await loadIndependentSettingsSections(
    async () => { throw new Error("notify read failed"); },
    async () => { throw new Error("LINE read failed"); },
  );

  assert.equal(notify.status, "error");
  assert.equal(line.status, "error");
  assert.equal(allSettingsSectionsLoaded(notify, line), false);
});

test("document不存在defaultとread errorを区別する", async () => {
  const missingDocument = normalizeAdminSystemNotificationSettings(undefined);
  assert.equal(missingDocument.source, "default");
  assert.deepEqual(missingDocument.settings, {
    emails: [],
    alertMonths: 6,
    validityYears: 3,
  });

  const [loadedDefault, readError] = await loadIndependentSettingsSections(
    async () => missingDocument,
    async () => { throw new Error("permission-denied"); },
  );
  assert.equal(loadedDefault.status, "loaded");
  assert.equal(readError.status, "error");
  assert.equal(allSettingsSectionsLoaded(loadedDefault, readError), false);
});

test("読取失敗flagを渡した保存guardは拒否する", () => {
  assert.doesNotThrow(() => assertSettingsSectionsLoaded({
    notifySettings: true,
    lineConfigs: true,
  }));
  assert.throws(() => assertSettingsSectionsLoaded({
    notifySettings: false,
    lineConfigs: true,
  }), /読み込めていないため保存できません/);
});

test("空collection成功とread errorを区別する", async () => {
  const [emptyCollection, readError] = await loadIndependentSettingsSections(
    async () => [],
    async () => { throw new Error("network error"); },
  );

  assert.deepEqual(emptyCollection, { status: "loaded", value: [] });
  assert.equal(readError.status, "error");
});
