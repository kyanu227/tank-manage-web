import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { readFile } from "node:fs/promises";

const PROJECT_ID = process.env.GCLOUD_PROJECT;
if (!PROJECT_ID?.startsWith("demo-")) {
  throw new Error("Rules test project ID must be supplied by Firebase CLI and start with demo-.");
}

const PORTAL_USER = {
  uid: "portal-user-1",
  email: "portal-1@example.com",
  customerId: "customer-1",
  customerName: "Rules顧客",
};
const OTHER_PORTAL_USER = {
  uid: "portal-user-2",
  email: "portal-2@example.com",
  customerId: "customer-2",
  customerName: "別Rules顧客",
};
const STAFF = {
  uid: "staff-uid",
  email: "rules-staff@example.com",
  staffId: "staff-1",
  name: "Rulesスタッフ",
  role: "一般",
};
const TANK_ID = "T001";
const LATEST_LOG_ID = "latest-log-1";
const MAX_CYCLE_MARKER_ID_LENGTH = 128;
const NO_MARKER = Symbol("no-marker");

const testEnvironment = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  },
});

try {
  await allows("legacy marker missing", async () => {
    await resetAndSeed();
    await createPortalReturn();
  });

  await allows("legacy marker missing with no current tank", async () => {
    await resetAndSeed({ tank: null });
    await createPortalReturn({ tankId: "missing-tank" });
  });

  await allows("valid marker", async () => {
    await resetAndSeed();
    await createPortalReturn({ expectedLatestLogId: LATEST_LOG_ID });
  });

  await rejects("customerId mismatch", async () => {
    await resetAndSeed({
      tank: {
        customerId: OTHER_PORTAL_USER.customerId,
        latestLogId: LATEST_LOG_ID,
      },
    });
    await createPortalReturn({ expectedLatestLogId: LATEST_LOG_ID });
  });

  await rejects("latestLogId mismatch", async () => {
    await resetAndSeed();
    await createPortalReturn({ expectedLatestLogId: "stale-log" });
  });

  await rejects("current tank customerId missing", async () => {
    await resetAndSeed({ tank: { latestLogId: LATEST_LOG_ID } });
    await createPortalReturn({ expectedLatestLogId: LATEST_LOG_ID });
  });

  await rejects("current tank latestLogId missing", async () => {
    await resetAndSeed({ tank: { customerId: PORTAL_USER.customerId } });
    await createPortalReturn({ expectedLatestLogId: LATEST_LOG_ID });
  });

  await rejects("null marker even when current latestLogId is null", async () => {
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: null },
    });
    await createPortalReturn({ expectedLatestLogId: null });
  });

  await rejects("number marker even when current latestLogId is the same number", async () => {
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: 123 },
    });
    await createPortalReturn({ expectedLatestLogId: 123 });
  });

  await rejects("map marker even when current latestLogId is the same map", async () => {
    const marker = { nested: "value" };
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: marker },
    });
    await createPortalReturn({ expectedLatestLogId: marker });
  });

  await rejects("list marker even when current latestLogId is the same list", async () => {
    const marker = ["value"];
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: marker },
    });
    await createPortalReturn({ expectedLatestLogId: marker });
  });

  await rejects("empty marker even when current latestLogId is empty", async () => {
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: "" },
    });
    await createPortalReturn({ expectedLatestLogId: "" });
  });

  await rejects("whitespace marker even when current latestLogId is whitespace", async () => {
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: "   " },
    });
    await createPortalReturn({ expectedLatestLogId: "   " });
  });

  await rejects("unknown key", async () => {
    await resetAndSeed();
    await createPortalReturn({
      expectedLatestLogId: LATEST_LOG_ID,
      unexpectedField: true,
    });
  });

  await rejects("unauthenticated principal", async () => {
    await resetAndSeed();
    await createPortalReturn(
      { expectedLatestLogId: LATEST_LOG_ID },
      testEnvironment.unauthenticatedContext().firestore(),
    );
  });

  await rejects("portal user linked to another customer", async () => {
    await resetAndSeed();
    await createPortalReturn(
      {
        expectedLatestLogId: LATEST_LOG_ID,
        customerId: OTHER_PORTAL_USER.customerId,
        customerName: OTHER_PORTAL_USER.customerName,
        createdByUid: OTHER_PORTAL_USER.uid,
      },
      portalContext(OTHER_PORTAL_USER),
    );
  });

  await rejects("createdByUid differs from authenticated portal user", async () => {
    await resetAndSeed({
      tank: {
        customerId: PORTAL_USER.customerId,
        latestLogId: LATEST_LOG_ID,
      },
    });
    await createPortalReturn({
      expectedLatestLogId: LATEST_LOG_ID,
      createdByUid: OTHER_PORTAL_USER.uid,
    });
  });

  await rejects("customerId is not linked to authenticated portal user", async () => {
    await resetAndSeed({
      tank: {
        customerId: OTHER_PORTAL_USER.customerId,
        latestLogId: LATEST_LOG_ID,
      },
    });
    await createPortalReturn({
      expectedLatestLogId: LATEST_LOG_ID,
      customerId: OTHER_PORTAL_USER.customerId,
      customerName: OTHER_PORTAL_USER.customerName,
    });
  });

  await rejects("marker longer than maximum even when current latestLogId matches", async () => {
    const marker = "L".repeat(MAX_CYCLE_MARKER_ID_LENGTH + 1);
    await resetAndSeed({
      tank: { customerId: PORTAL_USER.customerId, latestLogId: marker },
    });
    await createPortalReturn({ expectedLatestLogId: marker });
  });

  await rejects("marker present with no current tank", async () => {
    await resetAndSeed({ tank: null });
    await createPortalReturn({
      tankId: "missing-tank",
      expectedLatestLogId: LATEST_LOG_ID,
    });
  });

  for (const [label, invalidTankId] of [
    ["null", null],
    ["number", 123],
    ["empty", ""],
  ]) {
    await rejects(`marker present with ${label} tankId`, async () => {
      await resetAndSeed();
      await createPortalReturn({
        tankId: invalidTankId,
        expectedLatestLogId: LATEST_LOG_ID,
      });
    });
  }

  await rejects("marker present with whitespace tankId", async () => {
    await resetAndSeed({
      tank: null,
      extraDocuments: [
        ["tanks/   ", validTank()],
      ],
    });
    await createPortalReturn({
      tankId: "   ",
      expectedLatestLogId: LATEST_LOG_ID,
    });
  });

  await rejects("marker present with slash tankId", async () => {
    await resetAndSeed({
      tank: null,
      extraDocuments: [
        ["tanks/T001/nested/current", validTank()],
      ],
    });
    await createPortalReturn({
      tankId: "T001/nested/current",
      expectedLatestLogId: LATEST_LOG_ID,
    });
  });

  await rejects("tankId longer than maximum even when current tank matches", async () => {
    const tankId = "T".repeat(MAX_CYCLE_MARKER_ID_LENGTH + 1);
    await resetAndSeed({
      tank: null,
      extraDocuments: [
        [
          `tanks/${tankId}`,
          { customerId: PORTAL_USER.customerId, latestLogId: LATEST_LOG_ID },
        ],
      ],
    });
    await createPortalReturn({
      tankId,
      expectedLatestLogId: LATEST_LOG_ID,
    });
  });

  await allows("active staff create bypass remains unchanged", async () => {
    await resetAndSeed({ tank: null });
    await setDoc(doc(staffContext(), "transactions", "staff-bypass"), {
      ...portalReturnDocument({
        expectedLatestLogId: 123,
        tankId: null,
      }),
      createdByUid: STAFF.uid,
    });
  });

  await allows("staff completion preserves an existing marker", async () => {
    await resetAndSeed({ pendingReturn: true });
    await completePendingReturn();
  });

  await rejects("staff completion cannot change an existing marker", async () => {
    await resetAndSeed({ pendingReturn: true });
    await completePendingReturn({ expectedLatestLogId: "changed-log" });
  });

  await rejects("staff completion cannot delete an existing marker", async () => {
    await resetAndSeed({ pendingReturn: true });
    await completePendingReturn({ expectedLatestLogId: deleteField() });
  });
} finally {
  await testEnvironment.cleanup();
}

async function resetAndSeed({
  tank = validTank(),
  pendingReturn = false,
  extraDocuments = [],
} = {}) {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const writes = [
      setDoc(doc(firestore, "customerUsers", PORTAL_USER.uid), customerUser(PORTAL_USER)),
      setDoc(
        doc(firestore, "customerUsers", OTHER_PORTAL_USER.uid),
        customerUser(OTHER_PORTAL_USER),
      ),
      setDoc(doc(firestore, "staffByEmail", STAFF.email), {
        staffId: STAFF.staffId,
        name: STAFF.name,
        email: STAFF.email,
        role: STAFF.role,
        isActive: true,
      }),
      ...extraDocuments.map(([path, data]) => setDoc(doc(firestore, path), data)),
    ];

    if (tank !== null) {
      writes.push(setDoc(doc(firestore, "tanks", TANK_ID), tank));
    }
    if (pendingReturn) {
      writes.push(setDoc(
        doc(firestore, "transactions", "pending-return"),
        portalReturnDocument({ expectedLatestLogId: LATEST_LOG_ID }),
      ));
    }

    await Promise.all(writes);
  });
}

function validTank() {
  return {
    customerId: PORTAL_USER.customerId,
    latestLogId: LATEST_LOG_ID,
  };
}

function customerUser(user) {
  return {
    uid: user.uid,
    email: user.email,
    customerId: user.customerId,
    customerName: user.customerName,
    setupCompleted: true,
    disabled: false,
  };
}

function portalReturnDocument({ expectedLatestLogId = NO_MARKER, ...overrides } = {}) {
  const marker = expectedLatestLogId === NO_MARKER
    ? {}
    : { expectedLatestLogId };
  return {
    type: "return",
    status: "pending_return",
    tankId: TANK_ID,
    condition: "normal",
    customerId: PORTAL_USER.customerId,
    customerName: PORTAL_USER.customerName,
    createdByUid: PORTAL_USER.uid,
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000),
    source: "customer_portal",
    ...marker,
    ...overrides,
  };
}

function createPortalReturn(overrides = {}, firestore = portalContext(PORTAL_USER)) {
  return setDoc(
    doc(firestore, "transactions", "portal-return"),
    portalReturnDocument(overrides),
  );
}

function completePendingReturn(overrides = {}) {
  return updateDoc(doc(staffContext(), "transactions", "pending-return"), {
    status: "completed",
    finalCondition: "normal",
    fulfilledAt: serverTimestamp(),
    fulfilledBy: STAFF.name,
    fulfilledByStaffId: STAFF.staffId,
    fulfilledByStaffName: STAFF.name,
    fulfilledByStaffEmail: STAFF.email,
    updatedAt: serverTimestamp(),
    ...overrides,
  });
}

function portalContext(user) {
  return testEnvironment.authenticatedContext(user.uid, { email: user.email }).firestore();
}

function staffContext() {
  return testEnvironment.authenticatedContext(STAFF.uid, { email: STAFF.email }).firestore();
}

async function allows(label, operation) {
  await assertSucceeds(operation());
  process.stdout.write(`PASS allow: ${label}\n`);
}

async function rejects(label, operation) {
  await assertFails(operation());
  process.stdout.write(`PASS deny: ${label}\n`);
}
