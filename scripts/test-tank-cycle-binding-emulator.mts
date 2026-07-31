import { createRequire } from "node:module";

const requireFromHarness = createRequire(import.meta.url);

const PROJECT_ID = "demo-structural-smoke";
const FIRESTORE_HOST = "127.0.0.1:8090";
const AUTH_HOST = "127.0.0.1:9098";
const FIRESTORE_ORIGIN = `http://${FIRESTORE_HOST}`;
const AUTH_ORIGIN = `http://${AUTH_HOST}`;
const STAFF_UID = "staff-structural-smoke-auth";
const STAFF_ID = "staff-structural-smoke";
const STAFF_EMAIL = "structural-smoke@example.invalid";
const STAFF_PASSWORD = "structural-smoke-password";
const STAFF_NAME = "構造 smoke 管理者";
const WAREHOUSE = "倉庫";
const CUSTOMER_X = {
  customerId: "customer-x",
  customerName: "構造 smoke 顧客 X",
} as const;
const CUSTOMER_Y = {
  customerId: "customer-y",
  customerName: "構造 smoke 顧客 Y",
} as const;
const ACTOR = {
  staffId: STAFF_ID,
  staffName: STAFF_NAME,
  staffEmail: STAFF_EMAIL,
  role: "管理者",
} as const;

const DUMMY_WEB_CONFIG = {
  apiKey: "demo-structural-smoke-api-key",
  authDomain: "demo-structural-smoke.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "demo-structural-smoke.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
  measurementId: "G-STRUCTURAL-SMOKE",
} as const;

const REQUIRED_PUBLIC_ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: DUMMY_WEB_CONFIG.apiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: DUMMY_WEB_CONFIG.authDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: DUMMY_WEB_CONFIG.projectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: DUMMY_WEB_CONFIG.storageBucket,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: DUMMY_WEB_CONFIG.messagingSenderId,
  NEXT_PUBLIC_FIREBASE_APP_ID: DUMMY_WEB_CONFIG.appId,
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: DUMMY_WEB_CONFIG.measurementId,
} as const;

const FORBIDDEN_ENV_NAMES = [
  "FIREBASE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "DEBUG",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

const SNAPSHOT_COLLECTIONS = [
  "tanks",
  "logs",
  "transactions",
  "staffJoinRequests",
  "operationReviewEvents",
] as const;

// stale / missing marker 時は serverTimestamp field を含め、変化を一切許可しない。
const ZERO_DELTA_ALLOWED_FIELD_PATHS: readonly string[] = Object.freeze([]);

type FirebaseAppSdk = typeof import("firebase/app");
type FirebaseAuthSdk = typeof import("firebase/auth");
type FirestoreSdk = typeof import("firebase/firestore");
type ApplicationModules = Readonly<{
  tankOperation: typeof import("../src/lib/tank-operation");
  bulkQuery: typeof import("../src/features/staff-operations/queries/bulk-return-candidates");
  readiness: typeof import("../src/features/staff-operations/bulk-return-cycle-readiness");
  workflow: typeof import("../src/features/staff-operations/services/bulk-return-workflow");
}>;
type SeedMode = "normal" | "missing-cycle";
type PlainValue =
  | null
  | boolean
  | number
  | string
  | PlainValue[]
  | { [key: string]: PlainValue };
type PersistentSnapshot = Readonly<{
  collections: Record<string, readonly PlainValue[]>;
  tankAggregationRevision: PlainValue;
}>;

class HarnessFailure extends Error {
  constructor(readonly code: string, readonly variableName?: string) {
    super(variableName ? `${code}:${variableName}` : code);
    this.name = "HarnessFailure";
  }
}

function fail(code: string, variableName?: string): never {
  throw new HarnessFailure(code, variableName);
}

function expectCondition(
  condition: unknown,
  code: string,
  variableName?: string,
): asserts condition {
  if (!condition) fail(code, variableName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertApplicationEmulatorBindings(
  auth: import("firebase/auth").Auth,
  db: import("firebase/firestore").Firestore,
): void {
  // config.ts が export した実インスタンスの接続先を直接検査する。
  const authEmulator = auth.emulatorConfig;
  expectCondition(
    authEmulator !== null
    && authEmulator.protocol === "http"
    && authEmulator.host === "127.0.0.1"
    && authEmulator.port === 9098,
    "E_CONFIG_AUTH_EMULATOR",
  );

  const firestoreSettings = (
    db as unknown as { _getSettings?: () => unknown }
  )._getSettings?.();
  expectCondition(
    isRecord(firestoreSettings)
    && firestoreSettings.host === FIRESTORE_HOST
    && firestoreSettings.ssl === false
    && firestoreSettings.isUsingEmulator === true,
    "E_CONFIG_DB_EMULATOR",
  );
}

function requireExactEnv(
  variableName: string,
  expected: string,
): void {
  if (process.env[variableName] !== expected) {
    fail("E_ENV_EXACT", variableName);
  }
}

function validateRuntimeEnvironment(): string {
  FORBIDDEN_ENV_NAMES.forEach((name) => {
    if (process.env[name] !== undefined) fail("E_ENV_FORBIDDEN", name);
  });
  requireExactEnv("GCLOUD_PROJECT", PROJECT_ID);
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  if (googleCloudProject !== undefined && googleCloudProject !== PROJECT_ID) {
    fail("E_ENV_OPTIONAL_PROJECT", "GOOGLE_CLOUD_PROJECT");
  }
  requireExactEnv("FIRESTORE_EMULATOR_HOST", FIRESTORE_HOST);
  requireExactEnv("FIREBASE_AUTH_EMULATOR_HOST", AUTH_HOST);
  requireExactEnv(
    "FIREBASE_FIRESTORE_EMULATOR_ADDRESS",
    FIRESTORE_HOST,
  );

  const hubAddress = process.env.FIREBASE_EMULATOR_HUB;
  if (
    typeof hubAddress !== "string"
    || !/^127\.0\.0\.1:([1-9]\d{0,4})$/.test(hubAddress)
  ) {
    fail("E_ENV_IPV4_LOOPBACK", "FIREBASE_EMULATOR_HUB");
  }
  const hubPort = Number(hubAddress.slice(hubAddress.lastIndexOf(":") + 1));
  if (!Number.isSafeInteger(hubPort) || hubPort > 65_535) {
    fail("E_ENV_HUB_PORT", "FIREBASE_EMULATOR_HUB");
  }

  const firebaseConfigRaw = process.env.FIREBASE_CONFIG;
  if (typeof firebaseConfigRaw !== "string") {
    fail("E_ENV_REQUIRED", "FIREBASE_CONFIG");
  }
  let firebaseConfig: unknown;
  try {
    firebaseConfig = JSON.parse(firebaseConfigRaw);
  } catch {
    fail("E_ENV_JSON_OBJECT", "FIREBASE_CONFIG");
  }
  if (!isRecord(firebaseConfig)) {
    fail("E_ENV_JSON_OBJECT", "FIREBASE_CONFIG");
  }
  if (firebaseConfig.projectId !== PROJECT_ID) {
    fail("E_ENV_PROJECT", "FIREBASE_CONFIG");
  }

  Object.entries(REQUIRED_PUBLIC_ENV).forEach(([name, expected]) => {
    requireExactEnv(name, expected);
  });
  const publicFirebaseNames = Object.keys(process.env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_FIREBASE_"))
    .sort();
  const expectedPublicFirebaseNames = Object.keys(REQUIRED_PUBLIC_ENV).sort();
  if (
    publicFirebaseNames.length !== expectedPublicFirebaseNames.length
    || publicFirebaseNames.some(
      (name, index) => name !== expectedPublicFirebaseNames[index],
    )
  ) {
    fail("E_ENV_PUBLIC_ALLOWLIST", "NEXT_PUBLIC_FIREBASE_*");
  }

  return hubAddress;
}

async function validateStructuralSmokeConfig(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(
        new URL("../firebase.structural-smoke.json", import.meta.url),
        "utf8",
      ),
    );
  } catch {
    fail("E_CONFIG_READ");
  }
  if (!isRecord(parsed) || !isRecord(parsed.emulators)) {
    fail("E_CONFIG_SHAPE");
  }
  const { emulators } = parsed;
  const firestore = emulators.firestore;
  const auth = emulators.auth;
  const hub = emulators.hub;
  const logging = emulators.logging;
  const ui = emulators.ui;
  if (
    !isRecord(firestore)
    || firestore.host !== "127.0.0.1"
    || firestore.port !== 8090
    || firestore.websocketPort !== 9150
  ) {
    fail("E_CONFIG_FIRESTORE");
  }
  if (
    !isRecord(auth)
    || auth.host !== "127.0.0.1"
    || auth.port !== 9098
  ) {
    fail("E_CONFIG_AUTH");
  }
  if (!isRecord(hub) || hub.host !== "127.0.0.1") {
    fail("E_CONFIG_HUB");
  }
  if (
    !isRecord(logging)
    || logging.host !== "127.0.0.1"
    || logging.port !== 4500
  ) {
    fail("E_CONFIG_LOGGING");
  }
  if (!isRecord(ui) || ui.enabled !== false) {
    fail("E_CONFIG_UI");
  }
}

function validateHubListenerTree(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(validateHubListenerTree);
    return;
  }
  if (!isRecord(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    if (
      (key === "address" || key.toLowerCase().endsWith("host"))
      && child !== "127.0.0.1"
    ) {
      fail("E_HUB_NON_LOOPBACK");
    }
    if (
      key === "family"
      && child !== "IPv4"
      && child !== 4
    ) {
      fail("E_HUB_NON_IPV4");
    }
    validateHubListenerTree(child);
  });
}

async function verifyHubMapping(hubAddress: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`http://${hubAddress}/emulators`);
  } catch {
    fail("E_HUB_UNREACHABLE");
  }
  if (!response.ok) fail("E_HUB_RESPONSE");

  let mapping: unknown;
  try {
    mapping = await response.json();
  } catch {
    fail("E_HUB_JSON");
  }
  if (!isRecord(mapping)) fail("E_HUB_SHAPE");

  const firestore = mapping.firestore;
  const auth = mapping.auth;
  const hub = mapping.hub;
  if (
    !isRecord(firestore)
    || firestore.host !== "127.0.0.1"
    || firestore.port !== 8090
    || firestore.webSocketHost !== "127.0.0.1"
    || firestore.webSocketPort !== 9150
  ) {
    fail("E_HUB_FIRESTORE_MAPPING");
  }
  if (
    !isRecord(auth)
    || auth.host !== "127.0.0.1"
    || auth.port !== 9098
  ) {
    fail("E_HUB_AUTH_MAPPING");
  }
  if (!isRecord(hub) || hub.host !== "127.0.0.1") {
    fail("E_HUB_SELF_MAPPING");
  }
  if (mapping.ui !== undefined) fail("E_HUB_UI_ENABLED");
  validateHubListenerTree(mapping);
}

function getErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

async function assertPermissionDenied(
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "permission-denied" || code === "firestore/permission-denied") {
      return;
    }
    fail("E_NEGATIVE_PROBE_ERROR");
  }
  fail("E_NEGATIVE_PROBE_ALLOWED");
}

async function clearEmulatorData(): Promise<void> {
  const endpoints = [
    `${FIRESTORE_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    `${AUTH_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/accounts`,
  ];
  for (const endpoint of endpoints) {
    let response: Response;
    try {
      response = await fetch(endpoint, { method: "DELETE" });
    } catch {
      fail("E_EMULATOR_CLEAR_UNREACHABLE");
    }
    if (!response.ok) fail("E_EMULATOR_CLEAR_RESPONSE");
  }
}

async function resetAndSeedFixtures(mode: SeedMode): Promise<void> {
  await clearEmulatorData();

  const adminAppSdk = await import("firebase-admin/app");
  const adminAuthSdk = await import("firebase-admin/auth");
  const adminFirestoreSdk = await import("firebase-admin/firestore");
  if (adminAppSdk.getApps().length !== 0) fail("E_ADMIN_APP_PREEXISTING");

  let adminApp: import("firebase-admin/app").App | undefined;
  let primaryFailure: unknown;
  try {
    adminApp = adminAppSdk.initializeApp(
      { projectId: PROJECT_ID },
      "tank-cycle-binding-structural-smoke-fixture",
    );
    if (adminApp.options.projectId !== PROJECT_ID) {
      fail("E_ADMIN_PROJECT");
    }
    const adminAuth = adminAuthSdk.getAuth(adminApp);
    const adminDb = adminFirestoreSdk.getFirestore(adminApp);
    const fixtureTime = adminFirestoreSdk.Timestamp.fromMillis(0);

    const staffUser = await adminAuth.createUser({
      uid: STAFF_UID,
      email: STAFF_EMAIL,
      emailVerified: true,
      password: STAFF_PASSWORD,
      displayName: STAFF_NAME,
      disabled: false,
    });
    if (staffUser.uid !== STAFF_UID || staffUser.email !== STAFF_EMAIL) {
      fail("E_ADMIN_AUTH_FIXTURE");
    }

    const tankBase = {
      location: WAREHOUSE,
      staff: STAFF_NAME,
      customerId: null,
      customerName: null,
      logNote: "",
      updatedAt: fixtureTime,
    };
    const tankA98 = mode === "missing-cycle"
      ? {
          id: "A-98",
          status: "lent",
          location: CUSTOMER_X.customerName,
          staff: STAFF_NAME,
          customerId: CUSTOMER_X.customerId,
          customerName: CUSTOMER_X.customerName,
          latestLogId: "fixture-cycle-a98",
          logNote: "",
          updatedAt: fixtureTime,
        }
      : {
          id: "A-98",
          status: "filled",
          ...tankBase,
          latestLogId: "fixture-cycle-a98",
        };
    const tankA99 = mode === "missing-cycle"
      ? {
          id: "A-99",
          status: "lent",
          location: CUSTOMER_X.customerName,
          staff: STAFF_NAME,
          customerId: CUSTOMER_X.customerId,
          customerName: CUSTOMER_X.customerName,
          logNote: "",
          updatedAt: fixtureTime,
        }
      : {
          id: "A-99",
          status: "filled",
          ...tankBase,
          latestLogId: "fixture-cycle-a99",
        };

    await Promise.all([
      adminDb.doc(`staff/${STAFF_ID}`).set({
        id: STAFF_ID,
        authUid: STAFF_UID,
        name: STAFF_NAME,
        email: STAFF_EMAIL,
        isActive: true,
        role: "管理者",
        rank: "admin",
      }),
      adminDb.doc(`staffByEmail/${STAFF_EMAIL}`).set({
        staffId: STAFF_ID,
        uid: STAFF_UID,
        name: STAFF_NAME,
        email: STAFF_EMAIL,
        isActive: true,
        role: "管理者",
      }),
      adminDb.doc(`staffByUid/${STAFF_UID}`).set({
        staffId: STAFF_ID,
        uid: STAFF_UID,
        name: STAFF_NAME,
        email: STAFF_EMAIL,
        isActive: true,
        role: "管理者",
      }),
      adminDb.doc(`customers/${CUSTOMER_X.customerId}`).set({
        id: CUSTOMER_X.customerId,
        name: CUSTOMER_X.customerName,
        companyName: CUSTOMER_X.customerName,
        isActive: true,
      }),
      adminDb.doc(`customers/${CUSTOMER_Y.customerId}`).set({
        id: CUSTOMER_Y.customerId,
        name: CUSTOMER_Y.customerName,
        companyName: CUSTOMER_Y.customerName,
        isActive: true,
      }),
      adminDb.doc("customerUsers/X").set({
        uid: "X",
        email: "customer-x@example.invalid",
        selfCompanyName: CUSTOMER_X.customerName,
        selfName: "構造 smoke 利用者 X",
        lineName: "structural-x",
        customerId: CUSTOMER_X.customerId,
        customerName: CUSTOMER_X.customerName,
        setupCompleted: true,
        disabled: false,
      }),
      adminDb.doc("customerUsers/Y").set({
        uid: "Y",
        email: "customer-y@example.invalid",
        selfCompanyName: CUSTOMER_Y.customerName,
        selfName: "構造 smoke 利用者 Y",
        lineName: "structural-y",
        customerId: CUSTOMER_Y.customerId,
        customerName: CUSTOMER_Y.customerName,
        setupCompleted: true,
        disabled: false,
      }),
      adminDb.doc("settings/tankOperationPolicy").set({
        transitionEnforcement: "strict",
        policyRevision: 1,
        updatedAt: fixtureTime,
        updatedByStaffId: STAFF_ID,
        updatedByStaffName: STAFF_NAME,
      }),
      adminDb.doc("settings/tankAggregationRevision").set({
        tankDataRevision: 0,
        officialAggregationRevision: 0,
        updatedAt: fixtureTime,
        revisionChangeKind: "operation",
        changedLogIds: [],
        officialAggregationLogIds: [],
        reviewEventId: null,
        reviewDecision: null,
        affectedCustomerIds: [],
        hasUnknownAffectedCustomer: false,
      }),
      adminDb.doc("tanks/A-98").set(tankA98),
      adminDb.doc("tanks/A-99").set(tankA99),
      adminDb.doc("transactions/harness-pending-sentinel").set({
        type: "return",
        status: "pending_return",
        items: [],
        customerId: CUSTOMER_X.customerId,
        customerName: CUSTOMER_X.customerName,
        createdByUid: "fixture-only",
        createdAt: fixtureTime,
      }),
    ]);
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (adminApp) {
      try {
        await adminAppSdk.deleteApp(adminApp);
      } catch {
        if (primaryFailure === undefined) primaryFailure = new HarnessFailure("E_ADMIN_DELETE");
      }
    }
  }
  if (primaryFailure !== undefined) throw primaryFailure;
  if (adminAppSdk.getApps().length !== 0) fail("E_ADMIN_APP_REMAINING");
}

async function overwriteTankCustomerIdFixture(
  tankId: string,
  customerId: string,
): Promise<void> {
  const adminAppSdk = await import("firebase-admin/app");
  const adminFirestoreSdk = await import("firebase-admin/firestore");
  if (adminAppSdk.getApps().length !== 0) fail("E_ADMIN_APP_PREEXISTING");

  let adminApp: import("firebase-admin/app").App | undefined;
  let primaryFailure: unknown;
  try {
    adminApp = adminAppSdk.initializeApp(
      { projectId: PROJECT_ID },
      "tank-cycle-binding-customer-fixture",
    );
    if (adminApp.options.projectId !== PROJECT_ID) {
      fail("E_ADMIN_PROJECT");
    }
    const adminDb = adminFirestoreSdk.getFirestore(adminApp);
    await adminDb.doc(`tanks/${tankId}`).update({ customerId });
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (adminApp) {
      try {
        await adminAppSdk.deleteApp(adminApp);
      } catch {
        if (primaryFailure === undefined) primaryFailure = new HarnessFailure("E_ADMIN_DELETE");
      }
    }
  }
  if (primaryFailure !== undefined) throw primaryFailure;
  if (adminAppSdk.getApps().length !== 0) fail("E_ADMIN_APP_REMAINING");
}

async function assertNoAdminApps(): Promise<void> {
  const adminAppSdk = await import("firebase-admin/app");
  if (adminAppSdk.getApps().length !== 0) fail("E_ADMIN_APP_BOUNDARY");
}

async function signInAndProbe(
  authSdk: FirebaseAuthSdk,
  firestoreSdk: FirestoreSdk,
  auth: import("firebase/auth").Auth,
  db: import("firebase/firestore").Firestore,
): Promise<void> {
  await authSdk.signInWithEmailAndPassword(auth, STAFF_EMAIL, STAFF_PASSWORD);
  if (auth.currentUser?.uid !== STAFF_UID) fail("E_AUTH_UID");
  const staffSnapshot = await firestoreSdk.getDoc(
    firestoreSdk.doc(db, "staff", STAFF_ID),
  );
  if (!staffSnapshot.exists()) fail("E_RULES_POSITIVE_MISSING");
  const staff = staffSnapshot.data();
  if (
    staff.email !== STAFF_EMAIL
    || staff.isActive !== true
    || staff.role !== "管理者"
  ) {
    fail("E_RULES_POSITIVE_CONTENT");
  }
}

function normalizeFirestoreValue(
  value: unknown,
  firestoreSdk: FirestoreSdk,
): PlainValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { __number: "NaN" };
    if (value === Number.POSITIVE_INFINITY) return { __number: "+Infinity" };
    if (value === Number.NEGATIVE_INFINITY) return { __number: "-Infinity" };
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFirestoreValue(entry, firestoreSdk));
  }
  if (value instanceof firestoreSdk.Timestamp) {
    return {
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (value instanceof firestoreSdk.GeoPoint) {
    return {
      __type: "GeoPoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }
  if (value instanceof firestoreSdk.Bytes) {
    return {
      __type: "Bytes",
      base64: value.toBase64(),
    };
  }
  if (
    isRecord(value)
    && value.type === "document"
    && typeof value.path === "string"
  ) {
    return {
      __type: "DocumentReference",
      path: value.path,
    };
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeFirestoreValue(value[key], firestoreSdk)]),
    );
  }
  fail("E_SNAPSHOT_SPECIAL_TYPE");
}

async function takePersistentSnapshot(
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
): Promise<PersistentSnapshot> {
  const collections: Record<string, readonly PlainValue[]> = {};
  for (const collectionName of SNAPSHOT_COLLECTIONS) {
    const querySnapshot = await firestoreSdk.getDocs(
      firestoreSdk.collection(db, collectionName),
    );
    collections[collectionName] = querySnapshot.docs
      .map((snapshot) => ({
        id: snapshot.id,
        data: normalizeFirestoreValue(snapshot.data(), firestoreSdk),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
  const revisionSnapshot = await firestoreSdk.getDoc(
    firestoreSdk.doc(db, "settings", "tankAggregationRevision"),
  );
  return {
    collections,
    tankAggregationRevision: revisionSnapshot.exists()
      ? {
          id: revisionSnapshot.id,
          data: normalizeFirestoreValue(revisionSnapshot.data(), firestoreSdk),
        }
      : null,
  };
}

function assertDeepEqual(
  deepStrictEqual: typeof import("node:assert/strict").deepStrictEqual,
  actual: unknown,
  expected: unknown,
  code: string,
): void {
  try {
    deepStrictEqual(actual, expected);
  } catch {
    fail(code);
  }
}

function assertNoPersistentDelta(
  deepStrictEqual: typeof import("node:assert/strict").deepStrictEqual,
  before: PersistentSnapshot,
  after: PersistentSnapshot,
  code: string,
): void {
  if (ZERO_DELTA_ALLOWED_FIELD_PATHS.length !== 0) {
    fail("E_DELTA_ALLOWLIST_NOT_EMPTY");
  }
  assertDeepEqual(deepStrictEqual, after, before, code);
}

async function readTank(
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
  tankId: string,
): Promise<Record<string, unknown>> {
  const snapshot = await firestoreSdk.getDoc(
    firestoreSdk.doc(db, "tanks", tankId),
  );
  if (!snapshot.exists()) fail("E_TANK_MISSING");
  return snapshot.data();
}

async function readAggregationRevision(
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
): Promise<Record<string, unknown>> {
  const snapshot = await firestoreSdk.getDoc(
    firestoreSdk.doc(db, "settings", "tankAggregationRevision"),
  );
  if (!snapshot.exists()) fail("E_REVISION_MISSING");
  return snapshot.data();
}

async function performLend(
  modules: ApplicationModules,
  tankId: string,
  customer: typeof CUSTOMER_X | typeof CUSTOMER_Y,
): Promise<void> {
  await modules.tankOperation.applyTankOperation({
    tankId,
    transitionAction: "lend",
    context: {
      actor: ACTOR,
      customer,
      source: "manual",
      workflow: "tank_operation",
    },
    location: customer.customerName,
  });
}

async function performReturn(
  modules: ApplicationModules,
  tankId: string,
): Promise<void> {
  await modules.tankOperation.applyTankOperation({
    tankId,
    transitionAction: "return",
    context: {
      actor: ACTOR,
      source: "manual",
      workflow: "tank_operation",
    },
    location: WAREHOUSE,
  });
}

async function performFill(
  modules: ApplicationModules,
  tankId: string,
): Promise<void> {
  await modules.tankOperation.applyTankOperation({
    tankId,
    transitionAction: "fill",
    context: {
      actor: ACTOR,
      source: "manual",
      workflow: "tank_operation",
    },
    location: WAREHOUSE,
  });
}

async function fetchCandidate(
  modules: ApplicationModules,
  tankId: string,
): Promise<Awaited<ReturnType<ApplicationModules["bulkQuery"]["fetchBulkReturnCandidates"]>>["groupedTanks"][string][number]> {
  const result = await modules.bulkQuery.fetchBulkReturnCandidates();
  const matches = Object.values(result.groupedTanks)
    .flat()
    .filter((candidate) => candidate.id === tankId);
  if (matches.length !== 1) fail("E_CANDIDATE_COUNT");
  return matches[0];
}

function copyBulkCandidate(
  candidate: Awaited<ReturnType<ApplicationModules["bulkQuery"]["fetchBulkReturnCandidates"]>>["groupedTanks"][string][number],
) {
  return Object.freeze({
    id: candidate.id,
    status: candidate.status,
    customerId: candidate.customerId,
    latestLogId: candidate.latestLogId,
    location: candidate.location,
    tag: candidate.tag,
  });
}

async function captureStaleIssues(
  modules: ApplicationModules,
  operation: () => Promise<void>,
): Promise<readonly import("../src/lib/tank-operation").StaleTankCycleIssue[]> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof modules.tankOperation.StaleTankCycleError)) {
      fail("E_EXPECTED_STALE_TYPE");
    }
    return error.issues;
  }
  fail("E_EXPECTED_STALE_MISSING");
}

async function runChainOne(
  modules: ApplicationModules,
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
  deepStrictEqual: typeof import("node:assert/strict").deepStrictEqual,
): Promise<void> {
  // S1: 通常の domain operation で貸出し、projection/log/revision を確認する。
  await performLend(modules, "A-99", CUSTOMER_X);
  const lentTank = await readTank(firestoreSdk, db, "A-99");
  expectCondition(lentTank.status === "lent", "E_S1_TANK_STATUS");
  expectCondition(
    lentTank.customerId === CUSTOMER_X.customerId,
    "E_S1_TANK_CUSTOMER",
  );
  expectCondition(
    typeof lentTank.latestLogId === "string" && lentTank.latestLogId.length > 0,
    "E_S1_LATEST_LOG",
  );
  const lendLogSnapshot = await firestoreSdk.getDoc(
    firestoreSdk.doc(db, "logs", lentTank.latestLogId),
  );
  expectCondition(lendLogSnapshot.exists(), "E_S1_LOG_MISSING");
  const lendLog = lendLogSnapshot.data();
  expectCondition(lendLog.tankId === "A-99", "E_S1_LOG_TANK");
  expectCondition(lendLog.action === "lend", "E_S1_LOG_ACTION");
  expectCondition(
    lendLog.customerId === CUSTOMER_X.customerId,
    "E_S1_LOG_CUSTOMER",
  );
  const afterLendRevision = await readAggregationRevision(firestoreSdk, db);
  expectCondition(
    afterLendRevision.tankDataRevision === 1
    && afterLendRevision.officialAggregationRevision === 1,
    "E_S1_REVISION",
  );

  // S2: current object への参照を残さず primitive marker を copy する。
  const freshCandidate = await fetchCandidate(modules, "A-99");
  const oldCandidate = copyBulkCandidate(freshCandidate);
  expectCondition(oldCandidate !== freshCandidate, "E_S2_REFERENCE_COPY");
  assertDeepEqual(
    deepStrictEqual,
    modules.readiness.getBulkReturnGroupReadiness([oldCandidate]),
    { ready: true, issues: [] },
    "E_S2_READINESS",
  );

  // S3: fresh expectedCycle の bulk workflow が実 Rules 経由で成功する positive control。
  await modules.workflow.submitBulkReturnGroup({
    tanks: [oldCandidate],
    fallbackLocation: CUSTOMER_X.customerName,
    actor: ACTOR,
  });
  const returnedTank = await readTank(firestoreSdk, db, "A-99");
  expectCondition(returnedTank.status === "empty", "E_S3_BULK_RETURN_STATUS");
  expectCondition(
    returnedTank.latestLogId !== oldCandidate.latestLogId,
    "E_S3_BULK_RETURN_LOG",
  );
  await performFill(modules, "A-99");
  await performLend(modules, "A-99", CUSTOMER_Y);

  // S4: customer/latestLog の両 mismatch が stale になり、永続 delta は 0。
  const beforeStale = await takePersistentSnapshot(firestoreSdk, db);
  const issues = await captureStaleIssues(modules, () => (
    modules.workflow.submitBulkReturnGroup({
      tanks: [oldCandidate],
      fallbackLocation: CUSTOMER_X.customerName,
      actor: ACTOR,
    })
  ));
  assertDeepEqual(
    deepStrictEqual,
    issues,
    [
      { tankId: "A-99", field: "customerId", reason: "mismatch" },
      { tankId: "A-99", field: "latestLogId", reason: "mismatch" },
    ],
    "E_S4_ISSUES",
  );
  const afterStale = await takePersistentSnapshot(firestoreSdk, db);
  assertNoPersistentDelta(
    deepStrictEqual,
    beforeStale,
    afterStale,
    "E_S4_PERSISTENT_DELTA",
  );
}

async function runChainTwo(
  modules: ApplicationModules,
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
  deepStrictEqual: typeof import("node:assert/strict").deepStrictEqual,
): Promise<void> {
  // S5: reset 後に candidate を取り直し、同一顧客 ABA を単独 mismatch で証明する。
  await performLend(modules, "A-99", CUSTOMER_X);
  const firstCandidate = await fetchCandidate(modules, "A-99");
  const oldCandidate = copyBulkCandidate(firstCandidate);
  await performReturn(modules, "A-99");
  await performFill(modules, "A-99");
  await performLend(modules, "A-99", CUSTOMER_X);

  const current = await readTank(firestoreSdk, db, "A-99");
  expectCondition(
    current.customerId === oldCandidate.customerId,
    "E_S5_CUSTOMER_NOT_ABA",
  );
  expectCondition(
    typeof current.latestLogId === "string"
    && current.latestLogId !== oldCandidate.latestLogId,
    "E_S5_LOG_NOT_ABA",
  );

  const beforeStale = await takePersistentSnapshot(firestoreSdk, db);
  const issues = await captureStaleIssues(modules, () => (
    modules.workflow.submitBulkReturnGroup({
      tanks: [oldCandidate],
      fallbackLocation: CUSTOMER_X.customerName,
      actor: ACTOR,
    })
  ));
  assertDeepEqual(
    deepStrictEqual,
    issues,
    [{ tankId: "A-99", field: "latestLogId", reason: "mismatch" }],
    "E_S5_ISSUES",
  );
  const afterStale = await takePersistentSnapshot(firestoreSdk, db);
  assertNoPersistentDelta(
    deepStrictEqual,
    beforeStale,
    afterStale,
    "E_S5_PERSISTENT_DELTA",
  );
}

async function runChainThree(
  modules: ApplicationModules,
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
  deepStrictEqual: typeof import("node:assert/strict").deepStrictEqual,
): Promise<void> {
  // S6: 同一 group の1件欠落で readiness/workflow とも全件停止する。
  const result = await modules.bulkQuery.fetchBulkReturnCandidates();
  const matchingGroups = Object.values(result.groupedTanks).filter((group) => {
    const ids = group.map((candidate) => candidate.id).sort();
    return ids.length === 2 && ids[0] === "A-98" && ids[1] === "A-99";
  });
  if (matchingGroups.length !== 1) fail("E_S6_GROUP");
  const group = matchingGroups[0];
  const copiedGroup = group.map(copyBulkCandidate);
  assertDeepEqual(
    deepStrictEqual,
    modules.readiness.getBulkReturnGroupReadiness(copiedGroup),
    {
      ready: false,
      issues: [{ tankId: "A-99", field: "latestLogId" }],
    },
    "E_S6_READINESS",
  );

  const beforeMissing = await takePersistentSnapshot(firestoreSdk, db);
  const issues = await captureStaleIssues(modules, () => (
    modules.workflow.submitBulkReturnGroup({
      tanks: copiedGroup,
      fallbackLocation: CUSTOMER_X.customerName,
      actor: ACTOR,
    })
  ));
  assertDeepEqual(
    deepStrictEqual,
    issues,
    [{ tankId: "A-99", field: "latestLogId", reason: "missing_expected" }],
    "E_S6_ISSUES",
  );
  const afterMissing = await takePersistentSnapshot(firestoreSdk, db);
  assertNoPersistentDelta(
    deepStrictEqual,
    beforeMissing,
    afterMissing,
    "E_S6_PERSISTENT_DELTA",
  );
}

async function runChainFour(
  modules: ApplicationModules,
  firestoreSdk: FirestoreSdk,
  db: import("firebase/firestore").Firestore,
  deepStrictEqual: typeof import("node:assert/strict").deepStrictEqual,
): Promise<void> {
  // S7: latestLogId は一致したまま、customerId 単独 mismatch で全件停止する。
  await performLend(modules, "A-99", CUSTOMER_X);
  const freshCandidate = await fetchCandidate(modules, "A-99");
  const oldCandidate = copyBulkCandidate(freshCandidate);
  await overwriteTankCustomerIdFixture("A-99", CUSTOMER_Y.customerId);

  const beforeStale = await takePersistentSnapshot(firestoreSdk, db);
  const current = await readTank(firestoreSdk, db, "A-99");
  expectCondition(
    current.latestLogId === oldCandidate.latestLogId,
    "E_S7_LOG_CHANGED",
  );
  expectCondition(
    current.customerId !== oldCandidate.customerId,
    "E_S7_CUSTOMER_NOT_STALE",
  );
  const issues = await captureStaleIssues(modules, () => (
    modules.workflow.submitBulkReturnGroup({
      tanks: [oldCandidate],
      fallbackLocation: CUSTOMER_X.customerName,
      actor: ACTOR,
    })
  ));
  assertDeepEqual(
    deepStrictEqual,
    issues,
    [{ tankId: "A-99", field: "customerId", reason: "mismatch" }],
    "E_S7_ISSUES",
  );
  const afterStale = await takePersistentSnapshot(firestoreSdk, db);
  assertNoPersistentDelta(
    deepStrictEqual,
    beforeStale,
    afterStale,
    "E_S7_PERSISTENT_DELTA",
  );
}

async function cleanupFirebase(
  firebaseAppSdk: FirebaseAppSdk | undefined,
  authSdk: FirebaseAuthSdk | undefined,
  firestoreSdk: FirestoreSdk | undefined,
  app: import("firebase/app").FirebaseApp | undefined,
  auth: import("firebase/auth").Auth | undefined,
  db: import("firebase/firestore").Firestore | undefined,
): Promise<void> {
  let cleanupFailed = false;
  if (authSdk && auth) {
    try {
      await authSdk.signOut(auth);
    } catch {
      cleanupFailed = true;
    }
  }
  if (firestoreSdk && db) {
    try {
      await firestoreSdk.terminate(db);
    } catch {
      cleanupFailed = true;
    }
  }
  if (firebaseAppSdk && app) {
    try {
      await firebaseAppSdk.deleteApp(app);
    } catch {
      cleanupFailed = true;
    }
  }
  try {
    const adminAppSdk = await import("firebase-admin/app");
    await Promise.all(adminAppSdk.getApps().map((adminApp) => (
      adminAppSdk.deleteApp(adminApp)
    )));
    if (adminAppSdk.getApps().length !== 0) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }
  if (cleanupFailed) fail("E_CLEANUP");
}

async function executeHarness(): Promise<void> {
  let firebaseAppSdk: FirebaseAppSdk | undefined;
  let authSdk: FirebaseAuthSdk | undefined;
  let firestoreSdk: FirestoreSdk | undefined;
  let app: import("firebase/app").FirebaseApp | undefined;
  let auth: import("firebase/auth").Auth | undefined;
  let db: import("firebase/firestore").Firestore | undefined;
  let primaryFailure: unknown;

  try {
    // 最初の処理として、SDK import より前に全 env を fail closed で検査する。
    const hubAddress = validateRuntimeEnvironment();
    await validateStructuralSmokeConfig();
    await verifyHubMapping(hubAddress);

    // src/** の static import と同じ CJS build を使い、SDK registry を共有する。
    firebaseAppSdk = requireFromHarness("firebase/app") as FirebaseAppSdk;
    authSdk = requireFromHarness("firebase/auth") as FirebaseAuthSdk;
    firestoreSdk = requireFromHarness("firebase/firestore") as FirestoreSdk;
    if (firebaseAppSdk.getApps().length !== 0) fail("E_WEB_APP_PREEXISTING");

    app = firebaseAppSdk.initializeApp(DUMMY_WEB_CONFIG);
    if (app.options.projectId !== PROJECT_ID) fail("E_WEB_APP_PROJECT");
    auth = authSdk.getAuth(app);
    db = firestoreSdk.getFirestore(app);
    authSdk.connectAuthEmulator(auth, AUTH_ORIGIN, { disableWarnings: true });
    firestoreSdk.connectFirestoreEmulator(db, "127.0.0.1", 8090);

    const configModule = await import("../src/lib/firebase/config");
    expectCondition(configModule.app === app, "E_CONFIG_APP_SINGLETON");
    expectCondition(configModule.auth === auth, "E_CONFIG_AUTH_SINGLETON");
    expectCondition(configModule.db === db, "E_CONFIG_DB_SINGLETON");
    expectCondition(configModule.app.options.projectId === PROJECT_ID, "E_CONFIG_PROJECT");
    assertApplicationEmulatorBindings(configModule.auth, configModule.db);

    await assertPermissionDenied(() => firestoreSdk!.getDoc(
      firestoreSdk!.doc(db!, "staff", STAFF_ID),
    ));

    // chain 1 seed/login。Admin app は application module import 前に必ず破棄する。
    await resetAndSeedFixtures("normal");
    await assertNoAdminApps();
    await signInAndProbe(authSdk, firestoreSdk, auth, db);

    const modules: ApplicationModules = {
      tankOperation: await import("../src/lib/tank-operation"),
      bulkQuery: await import("../src/features/staff-operations/queries/bulk-return-candidates"),
      readiness: await import("../src/features/staff-operations/bulk-return-cycle-readiness"),
      workflow: await import("../src/features/staff-operations/services/bulk-return-workflow"),
    };
    // application module の依存読み込み後も同じ SDK singleton / Emulator 接続を維持する。
    expectCondition(configModule.app === app, "E_CONFIG_APP_SINGLETON");
    expectCondition(configModule.auth === auth, "E_CONFIG_AUTH_SINGLETON");
    expectCondition(configModule.db === db, "E_CONFIG_DB_SINGLETON");
    assertApplicationEmulatorBindings(configModule.auth, configModule.db);
    const { deepStrictEqual } = await import("node:assert/strict");

    await runChainOne(modules, firestoreSdk, db, deepStrictEqual);
    process.stdout.write("PASS chain 1: S1-S4\n");

    await authSdk.signOut(auth);
    await resetAndSeedFixtures("normal");
    await assertNoAdminApps();
    await signInAndProbe(authSdk, firestoreSdk, auth, db);
    await runChainTwo(modules, firestoreSdk, db, deepStrictEqual);
    process.stdout.write("PASS chain 2: S5 same-customer ABA\n");

    await authSdk.signOut(auth);
    await resetAndSeedFixtures("missing-cycle");
    await assertNoAdminApps();
    await signInAndProbe(authSdk, firestoreSdk, auth, db);
    await runChainThree(modules, firestoreSdk, db, deepStrictEqual);
    process.stdout.write("PASS chain 3: S6 all-or-nothing\n");

    await authSdk.signOut(auth);
    await resetAndSeedFixtures("normal");
    await assertNoAdminApps();
    await signInAndProbe(authSdk, firestoreSdk, auth, db);
    await runChainFour(modules, firestoreSdk, db, deepStrictEqual);
    process.stdout.write("PASS chain 4: S7 customer-only stale\n");
  } catch (error) {
    primaryFailure = error;
  }

  try {
    await cleanupFirebase(firebaseAppSdk, authSdk, firestoreSdk, app, auth, db);
  } catch (error) {
    if (primaryFailure === undefined) primaryFailure = error;
  }

  if (primaryFailure !== undefined) {
    const safeMessage = primaryFailure instanceof HarnessFailure
      ? primaryFailure.message
      : "E_UNEXPECTED_REDACTED";
    process.stderr.write(`FAIL ${safeMessage}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS tank cycle binding emulator harness\n");
}

await executeHarness();
