import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROJECT_ID = "demo-cutover-freeze-rules";
const FREEZE_RULES_PATH = new URL("../firestore.cutover-freeze.rules", import.meta.url);
const BASELINE_RULES_PATH = new URL("../firestore.cutover-baseline.rules", import.meta.url);
const BASELINE_MANIFEST_PATH = new URL(
  "../firestore.cutover-baseline.manifest.json",
  import.meta.url,
);
const BASELINE_CONFIG_PATH = new URL("../firebase.cutover-baseline.json", import.meta.url);
const FREEZE_CONFIG_PATH = new URL("../firebase.cutover-freeze.json", import.meta.url);
const NORMAL_CONFIG_PATH = new URL("../firebase.cutover-normal-rules.json", import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PINNED_BASELINE_GIT_COMMIT = "b7e853c8f38071937951b871cbe0e3281dd22876";
const PINNED_BASELINE_RULES_SHA256 = "6c9d126dad4980f20f92feda660d13a7d3840b1625d3ac4c74da27ce9e31e1a8";
const PINNED_RELEASE_CREATE_TIME = "2026-03-11T07:36:20.560827Z";
const PINNED_RELEASE_UPDATE_TIME = "2026-07-18T08:48:41.527284Z";
const PINNED_RULESET_NAME = "projects/okmarine-tankrental/rulesets/a6a7e85b-1761-44f4-a714-cc53957611e8";
const PINNED_RULESET_CREATE_TIME = "2026-07-18T08:48:40.023823Z";
const EXPECTED_FREEZE_RULES = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

await assertRulesAndConfigsAreDedicated();

const testEnvironment = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: await readFile(FREEZE_RULES_PATH, "utf8"),
  },
});

try {
  await testEnvironment.clearFirestore();
  await seedFixturesAndProveRulesBypass();

  await assertActorDenied("admin", testEnvironment.authenticatedContext(
    "admin-uid",
    { email: "admin@example.com" },
  ), {
    get: ["settings", "tankOperationPolicy"],
    list: "customers",
    create: ["priceMaster", "admin-create"],
    update: ["priceMaster", "admin-update"],
    delete: ["priceMaster", "admin-delete"],
  });

  await assertActorDenied("staff", testEnvironment.authenticatedContext(
    "staff-uid",
    { email: "staff@example.com" },
  ), {
    get: ["tanks", "T001"],
    list: "logs",
    create: ["orders", "staff-create"],
    update: ["orders", "staff-update"],
    delete: ["orders", "staff-delete"],
  });

  await assertActorDenied("portal", testEnvironment.authenticatedContext(
    "portal-uid",
    { email: "portal@example.com" },
  ), {
    get: ["customerUsers", "portal-uid"],
    list: "transactions",
    create: ["transactions", "portal-create"],
    update: ["customerUsers", "portal-uid"],
    delete: ["transactions", "portal-delete"],
  });

  await assertActorDenied("unauthenticated", testEnvironment.unauthenticatedContext(), {
    get: ["settings", "portal"],
    list: "tanks",
    create: ["transactions", "unauthenticated-create"],
    update: ["transactions", "unauthenticated-update"],
    delete: ["transactions", "unauthenticated-delete"],
  });

  await assertDeniedOperationsDidNotMutateFixtures();
  console.log("PASS: cutover freeze rules deny every tested client read/write operation");
} finally {
  await testEnvironment.cleanup();
}

async function assertRulesAndConfigsAreDedicated() {
  const rules = (await readFile(FREEZE_RULES_PATH, "utf8")).replaceAll("\r\n", "\n").trim();
  assert.equal(rules, EXPECTED_FREEZE_RULES, "freeze ruleset must remain an exact deny-all ruleset");

  const baselineManifest = await readJson(BASELINE_MANIFEST_PATH);
  assert.equal(baselineManifest.version, 2);
  assert.equal(baselineManifest.projectId, "okmarine-tankrental");
  assert.equal(baselineManifest.gitCommit, PINNED_BASELINE_GIT_COMMIT);
  assert.equal(baselineManifest.normalizedSha256, PINNED_BASELINE_RULES_SHA256);
  assert.equal(baselineManifest.pinnedGitRulesFile, "firestore.rules");
  assert.equal(baselineManifest.liveRulesSourceFile, "firestore.cutover-baseline.rules");
  assert.equal(
    baselineManifest.releaseName,
    "projects/okmarine-tankrental/releases/cloud.firestore",
  );
  assert.equal(baselineManifest.releaseCreateTime, PINNED_RELEASE_CREATE_TIME);
  assert.equal(baselineManifest.releaseUpdateTime, PINNED_RELEASE_UPDATE_TIME);
  assert.equal(baselineManifest.rulesetName, PINNED_RULESET_NAME);
  assert.equal(baselineManifest.rulesetCreateTime, PINNED_RULESET_CREATE_TIME);

  const rawBaselineRules = await readFile(BASELINE_RULES_PATH, "utf8");
  const baselineRules = normalizeRulesSource(rawBaselineRules);
  assert.equal(
    createHash("sha256").update(baselineRules, "utf8").digest("hex"),
    PINNED_BASELINE_RULES_SHA256,
    "baseline rollback rules must match the pinned live production artifact",
  );
  assert.equal(Buffer.byteLength(baselineRules, "utf8"), baselineManifest.normalizedBytes);
  const rawGitRules = execFileSync(
    "git",
    ["show", `${PINNED_BASELINE_GIT_COMMIT}:firestore.rules`],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(
    rawBaselineRules,
    rawGitRules,
    "baseline rollback rules must match the pinned Git commit",
  );

  const baselineConfig = await readJson(BASELINE_CONFIG_PATH);
  const freezeConfig = await readJson(FREEZE_CONFIG_PATH);
  const normalConfig = await readJson(NORMAL_CONFIG_PATH);
  assert.deepEqual(baselineConfig, {
    firestore: { rules: "firestore.cutover-baseline.rules" },
  });
  assert.equal(
    baselineConfig.firestore.rules,
    baselineManifest.liveRulesSourceFile,
    "rollback deploy config must match the attested live source filename",
  );
  assert.deepEqual(freezeConfig, {
    firestore: { rules: "firestore.cutover-freeze.rules" },
  });
  assert.deepEqual(normalConfig, {
    firestore: { rules: "firestore.rules" },
  });

  for (const [label, config] of [
    ["baseline", baselineConfig],
    ["freeze", freezeConfig],
    ["normal", normalConfig],
  ]) {
    assert.deepEqual(Object.keys(config), ["firestore"], `${label} config must be rules-only`);
    assert.deepEqual(
      Object.keys(config.firestore),
      ["rules"],
      `${label} config must not include indexes or other Firestore deploy targets`,
    );
    assert.equal("hosting" in config, false, `${label} config must not include Hosting`);
    assert.equal("functions" in config, false, `${label} config must not include Functions`);
  }
}

async function seedFixturesAndProveRulesBypass() {
  await assertSucceeds(testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const fixtures = [
      ["settings/tankOperationPolicy", { transitionEnforcement: "strict" }],
      ["settings/portal", { autoReturnHour: 17 }],
      ["customers/customer-1", { name: "fixture" }],
      ["tanks/T001", { status: "empty", location: "warehouse" }],
      ["logs/log-1", { logKind: "tank" }],
      ["priceMaster/admin-update", { value: 1 }],
      ["priceMaster/admin-delete", { value: 1 }],
      ["orders/staff-update", { status: "pending" }],
      ["orders/staff-delete", { status: "pending" }],
      ["customerUsers/portal-uid", { uid: "portal-uid", setupCompleted: true }],
      ["transactions/portal-delete", { type: "return" }],
      ["transactions/unauthenticated-update", { type: "return" }],
      ["transactions/unauthenticated-delete", { type: "return" }],
    ];
    await Promise.all(fixtures.map(([path, data]) => setDoc(doc(firestore, path), data)));

    const bypassProbe = doc(firestore, "cutoverFreezeBypassProof", "probe");
    await setDoc(bypassProbe, { phase: "created" });
    assert.equal((await getDoc(bypassProbe)).data()?.phase, "created");
    assert.equal((await getDocs(collection(firestore, "cutoverFreezeBypassProof"))).size, 1);
    await updateDoc(bypassProbe, { phase: "updated" });
    assert.equal((await getDoc(bypassProbe)).data()?.phase, "updated");
    await deleteDoc(bypassProbe);
    assert.equal((await getDoc(bypassProbe)).exists(), false);
  }));
}

async function assertActorDenied(label, context, paths) {
  const firestore = context.firestore();
  await denied(`${label} get`, getDoc(doc(firestore, ...paths.get)));
  await denied(`${label} list`, getDocs(collection(firestore, paths.list)));
  await denied(
    `${label} create`,
    setDoc(doc(firestore, ...paths.create), { attemptedBy: label }),
  );
  await denied(
    `${label} update`,
    updateDoc(doc(firestore, ...paths.update), { attemptedBy: label }),
  );
  await denied(`${label} delete`, deleteDoc(doc(firestore, ...paths.delete)));
}

async function assertDeniedOperationsDidNotMutateFixtures() {
  await assertSucceeds(testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const absentCreates = [
      "priceMaster/admin-create",
      "orders/staff-create",
      "transactions/portal-create",
      "transactions/unauthenticated-create",
    ];
    for (const path of absentCreates) {
      assert.equal((await getDoc(doc(firestore, path))).exists(), false, `${path} must not exist`);
    }
    assert.deepEqual((await getDoc(doc(firestore, "priceMaster/admin-update"))).data(), { value: 1 });
    assert.equal((await getDoc(doc(firestore, "priceMaster/admin-delete"))).exists(), true);
    assert.deepEqual((await getDoc(doc(firestore, "orders/staff-update"))).data(), {
      status: "pending",
    });
    assert.equal((await getDoc(doc(firestore, "orders/staff-delete"))).exists(), true);
    assert.deepEqual((await getDoc(doc(firestore, "customerUsers/portal-uid"))).data(), {
      uid: "portal-uid",
      setupCompleted: true,
    });
    assert.equal((await getDoc(doc(firestore, "transactions/portal-delete"))).exists(), true);
    assert.deepEqual(
      (await getDoc(doc(firestore, "transactions/unauthenticated-update"))).data(),
      { type: "return" },
    );
    assert.equal(
      (await getDoc(doc(firestore, "transactions/unauthenticated-delete"))).exists(),
      true,
    );
  }));
}

async function denied(label, promise) {
  try {
    await assertFails(promise);
  } catch (error) {
    throw new Error(`${label} was not denied by the freeze ruleset`, { cause: error });
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeRulesSource(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  assert(!normalized.includes("\r"), "baseline rules must use valid line endings");
  assert(normalized.length > 0, "baseline rules must not be empty");
  return `${normalized.replace(/\n+$/u, "")}\n`;
}
