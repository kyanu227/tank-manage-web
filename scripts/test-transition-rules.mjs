import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PROJECT_ID = "tank-transition-rules-test";
const ADMIN = {
  uid: "admin-uid",
  email: "rules-admin@example.com",
  staffId: "admin-1",
  name: "Rules管理者",
  role: "管理者",
};
const OTHER_ADMIN = {
  uid: "other-admin-uid",
  email: "other-admin@example.com",
  staffId: "admin-2",
  name: "別管理者",
  role: "管理者",
};
const WORKER = {
  uid: "worker-uid",
  email: "rules-worker@example.com",
  staffId: "worker-1",
  name: "Rulesスタッフ",
  role: "一般",
};
const CUSTOMER = {
  customerId: "customer-1",
  customerName: "Rules顧客",
};
const OTHER_CUSTOMER = {
  customerId: "customer-2",
  customerName: "別Rules顧客",
};
const WAREHOUSE = "倉庫";
const OLD_TANK_MAINTENANCE_DATE = new Date("2025-01-01T00:00:00.000Z");
const OLD_TANK_NEXT_MAINTENANCE_DATE = new Date("2030-01-01T00:00:00.000Z");
const NEW_TANK_MAINTENANCE_DATE = new Date("2026-02-01T00:00:00.000Z");
const NEW_TANK_NEXT_MAINTENANCE_DATE = new Date("2031-02-01T00:00:00.000Z");

const testEnvironment = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  },
});

try {
  await succeeds("strict direct operation: 1", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({ size: 1, kind: "direct" });
  });

  await succeeds("inspection may update maintenance projection", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await seedMaintenanceProjection("T001", {
      maintenanceDate: OLD_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: OLD_TANK_NEXT_MAINTENANCE_DATE,
    });
    const prevTankSnapshot = tankSnapshot({
      status: "empty",
      maintenanceDate: OLD_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: OLD_TANK_NEXT_MAINTENANCE_DATE,
    });
    const nextTankSnapshot = tankSnapshot({
      status: "empty",
      staff: ADMIN.name,
      maintenanceDate: NEW_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: NEW_TANK_NEXT_MAINTENANCE_DATE,
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: {
        action: "inspection",
        transitionAction: "inspection",
        prevStatus: "empty",
        newStatus: "empty",
        transitionPlan: directPlan("inspection", "empty", "empty"),
        prevTankSnapshot,
        nextTankSnapshot,
      },
    });
  });

  await succeeds("missing policy document defaults to strict revision 0", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), "settings", "tankOperationPolicy"));
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { policyRevision: 0 },
    });
  });

  await succeeds("invalid policy mode normalizes to strict and preserves valid revision", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await seedRawPolicy({
      transitionEnforcement: "invalid-mode",
      policyRevision: 7,
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      policyRevision: 7,
    });
  });

  await succeeds("invalid policy revision normalizes to strict revision 0", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await seedRawPolicy({
      transitionEnforcement: "advisory",
      policyRevision: "invalid-revision",
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      policyRevision: 0,
    });
  });

  for (const size of [1, 10, 50, 100]) {
    await succeeds(`worker advisory recovery operation: ${size}`, async () => {
      await resetAndSeed({ size, policyMode: "advisory", policyRevision: 2 });
      await executeOperationBatch({ size, kind: "recovery", actor: WORKER });
    });
  }

  await succeeds("worker advisory three-step re-lend recovery: 100", async () => {
    await resetAndSeed({
      size: 100,
      policyMode: "advisory",
      policyRevision: 2,
      tankState: "lent",
      tankCustomer: CUSTOMER,
    });
    const prevTankSnapshot = tankSnapshot({ status: "lent", customer: CUSTOMER });
    const nextTankSnapshot = tankSnapshot({
      status: "lent",
      customer: OTHER_CUSTOMER,
      staff: WORKER.name,
    });
    await executeOperationBatch({
      size: 100,
      kind: "recovery",
      actor: WORKER,
      logOverrides: ({ id }) => ({
        ...OTHER_CUSTOMER,
        location: OTHER_CUSTOMER.customerName,
        transitionPlan: recoveryRelendPlan(),
        recoveryEvidence: {
          physicalTankConfirmed: true,
          possessionConfirmed: true,
          previousCustomerConfirmed: true,
          fillStateConfirmed: true,
        },
        affectedCustomerIds: [CUSTOMER.customerId, OTHER_CUSTOMER.customerId].sort(),
        prevStatus: "lent",
        newStatus: "lent",
        prevTankSnapshot,
        nextTankSnapshot,
        previousLogIdOnSameTank: `previous-${id}`,
      }),
    });
  });

  await succeeds("worker advisory in-house close recovery", async () => {
    await resetAndSeed({
      size: 1,
      policyMode: "advisory",
      policyRevision: 2,
      tankState: "in_house",
    });
    const prevTankSnapshot = tankSnapshot({ status: "in_house" });
    const nextTankSnapshot = tankSnapshot({
      status: "lent",
      customer: CUSTOMER,
      staff: WORKER.name,
    });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      actor: WORKER,
      logOverrides: {
        transitionPlan: recoveryInHouseLendPlan(),
        recoveryEvidence: {
          physicalTankConfirmed: true,
          possessionConfirmed: true,
          fillStateConfirmed: true,
        },
        affectedCustomerIds: [CUSTOMER.customerId],
        prevStatus: "in_house",
        newStatus: "lent",
        prevTankSnapshot,
        nextTankSnapshot,
        previousLogIdOnSameTank: "previous-T001",
      },
    });
  });

  await succeeds("staff bulk-return recovery uses the same advisory boundary", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { source: "bulk_return" },
    });
  });

  await fails("atomic operation limit rejects 101 tanks", async () => {
    await resetAndSeed({ size: 101, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({ size: 101, kind: "recovery" });
  });

  for (const size of [1, 100]) {
    await succeeds(`pending review approved: ${size}`, async () => {
      await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
      await seedPendingRecoveries(size);
      await executeReviewBatch({ size, decision: "approved", actor: ADMIN });
    });
  }

  await fails("pending review rejects 101 logs", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(101);
    await executeReviewBatch({ size: 101, decision: "approved", actor: ADMIN });
  });

  await succeeds("pending review excluded keeps official revision", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(1);
    await executeReviewBatch({ size: 1, decision: "excluded", actor: ADMIN });
  });

  await succeeds("admin policy update", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await updatePolicyAs(ADMIN, "advisory", 2);
  });

  await succeeds("known return tag marker remains writable", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await updateDoc(doc(contextFor(WORKER), "tanks", "T001"), {
      logNote: "[TAG:unused]",
    });
  });

  await succeeds("known non-tank log kind remains writable without changing kind", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    const logRef = doc(contextFor(WORKER), "logs", "known-order-log");
    await setDoc(logRef, { logKind: "order", note: "before" });
    await updateDoc(logRef, { note: "after" });
  });

  await succeeds("existing strict return transaction completion remains unchanged", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "transactions", "strict-return"), {
        type: "return",
        status: "pending_return",
        tankId: "T001",
        ...CUSTOMER,
        createdAt: new Date(1_000),
      });
    });
    await updateDoc(doc(contextFor(ADMIN), "transactions", "strict-return"), {
      status: "completed",
      finalCondition: "normal",
      fulfilledAt: serverTimestamp(),
      fulfilledBy: ADMIN.name,
      fulfilledByStaffId: ADMIN.staffId,
      fulfilledByStaffName: ADMIN.name,
      fulfilledByStaffEmail: ADMIN.email,
    });
  });

  await succeeds("valid direct log void", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeVoid();
  });

  await succeeds("valid direct log correction", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeCorrection();
  });

  await succeeds("latest active recovery log may be voided", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedActiveRecoveryLog();
    await executeVoid();
  });

  await succeeds("voided recovery is re-executed as a distinct pending log", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedActiveRecoveryLog();
    await executeVoid();
    await executeRecoveryAfterVoid();

    const firestore = contextFor(ADMIN);
    const [oldLog, rerunLog, tank] = await Promise.all([
      getDoc(doc(firestore, "logs", "active-log")),
      getDoc(doc(firestore, "logs", "rerun-recovery-log")),
      getDoc(doc(firestore, "tanks", "T001")),
    ]);
    assert.equal(oldLog.data()?.logStatus, "voided");
    assert.equal(rerunLog.data()?.transitionPlan?.kind, "recovery");
    assert.equal(rerunLog.data()?.transitionReviewStatus, "pending");
    assert.equal(rerunLog.data()?.recoveryConfirmationFingerprint?.length, 64);
    assert.equal(rerunLog.data()?.recoveryEvidence?.physicalTankConfirmed, true);
    assert.equal(tank.data()?.latestLogId, rerunLog.id);
    assert.notEqual(rerunLog.id, oldLog.id);
  });

  await succeeds("recent worker correction remains allowed", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog({ revisionCreatedAt: new Date() });
    await executeCorrection({}, WORKER);
  });

  await succeeds("valid cross-tank correction preserves both snapshots", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedCrossTankCorrectionFixture();
    await executeCrossTankCorrection();
  });

  await succeeds("valid rental-close plan matches the previous holder", async () => {
    await resetAndSeed({
      size: 1,
      policyMode: "strict",
      policyRevision: 1,
      tankState: "lent",
      tankCustomer: CUSTOMER,
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: directReturnOverrides(CUSTOMER),
    });
  });

  await runDenialCases();
} finally {
  await testEnvironment.cleanup();
}

async function runDenialCases() {
  await fails("strict policy rejects recovery", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { policyMode: "strict", policyRevision: 1 },
    });
  });

  await fails("policyMode spoof is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { policyMode: "advisory" },
    });
  });

  await fails("policyRevision spoof is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { policyRevision: 999 },
    });
  });

  await fails("initial operation timestamp cannot be backdated", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { timestamp: new Date(1_000) },
    });
  });

  await fails("initial operation originalAt cannot be backdated", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { originalAt: new Date(1_000) },
    });
  });

  await fails("direct visible action must match its normalized transition", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { action: "return" },
    });
  });

  await fails("non-inspection operation cannot change maintenance projection", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await seedMaintenanceProjection("T001", {
      maintenanceDate: OLD_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: OLD_TANK_NEXT_MAINTENANCE_DATE,
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: {
        prevTankSnapshot: tankSnapshot({
          status: "empty",
          maintenanceDate: OLD_TANK_MAINTENANCE_DATE,
          nextMaintenanceDate: OLD_TANK_NEXT_MAINTENANCE_DATE,
        }),
        nextTankSnapshot: tankSnapshot({
          status: "filled",
          staff: ADMIN.name,
          maintenanceDate: NEW_TANK_MAINTENANCE_DATE,
          nextMaintenanceDate: NEW_TANK_NEXT_MAINTENANCE_DATE,
        }),
      },
    });
  });

  await fails("tank-only projection update is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({ size: 1, kind: "direct", omitLogWrites: true });
  });

  await fails("arbitrary logNote-only tank update is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await updateDoc(doc(contextFor(WORKER), "tanks", "T001"), {
      logNote: "arbitrary-note",
    });
  });

  await fails("log-only operation is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({ size: 1, kind: "direct", omitTankWrites: true });
  });

  await fails("tank.latestLogId mismatch is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({ size: 1, kind: "direct", mismatchedLatestLogId: true });
  });

  await fails("non-tank log cannot be promoted to a tank log", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    const logRef = doc(contextFor(WORKER), "logs", "legacy-non-tank");
    await setDoc(logRef, {
      logKind: "order",
      note: "既存の非タンクログ",
    });
    await updateDoc(logRef, { logKind: "tank" });
  });

  await fails("unknown non-tank log kind cannot be created", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await setDoc(doc(contextFor(WORKER), "logs", "unknown-log"), {
      logKind: "bogus",
      logStatus: "active",
    });
  });

  await fails("known non-tank log kind cannot be changed", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    const logRef = doc(contextFor(WORKER), "logs", "kind-change-log");
    await setDoc(logRef, { logKind: "order", note: "before" });
    await updateDoc(logRef, { logKind: "procurement" });
  });

  await fails("different staff operation actor is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: {
        staffId: OTHER_ADMIN.staffId,
        staffName: OTHER_ADMIN.name,
        staffEmail: OTHER_ADMIN.email,
      },
    });
  });

  await fails("different admin review actor is rejected", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(1);
    await executeReviewBatch({
      size: 1,
      decision: "approved",
      actor: ADMIN,
      savedActor: OTHER_ADMIN,
    });
  });

  await fails("review event and log reason must match", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(1);
    await executeReviewBatch({
      size: 1,
      decision: "approved",
      actor: ADMIN,
      eventReason: "Rulesイベント理由",
      logReason: "Rulesログ別理由",
    });
  });

  await fails("worker cannot review", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(1);
    await executeReviewBatch({ size: 1, decision: "approved", actor: WORKER });
  });

  await fails("approved review is terminal", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedResolvedRecovery("approved");
    await updateTerminalReview("excluded");
  });

  await fails("excluded review is terminal", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedResolvedRecovery("excluded");
    await updateTerminalReview("approved");
  });

  await fails("active transitionPlan is immutable", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(1);
    await updatePlanAsAdmin();
  });

  await fails("standalone aggregation revision update is rejected", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await updateRevisionOnly();
  });

  await fails("aggregation revision cannot be deleted by admin", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await deleteDoc(doc(contextFor(ADMIN), "settings", "tankAggregationRevision"));
  });

  await fails("operation policy cannot be deleted by admin", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await deleteDoc(doc(contextFor(ADMIN), "settings", "tankOperationPolicy"));
  });

  await fails("tank operation log cannot be deleted by admin", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await deleteDoc(doc(contextFor(ADMIN), "logs", "active-log"));
  });

  await fails("correction cannot change the original business timestamp", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeCorrection({ originalAt: new Date(2_000) });
  });

  await fails("correction cannot change the inherited timestamp", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeCorrection({ timestamp: new Date(2_000) });
  });

  await fails("recovery log cannot be corrected directly", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedActiveRecoveryLog();
    await executeCorrection();
  });

  await fails("past recovery log with a later active log cannot be voided", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedActiveRecoveryLog({ withLaterActiveLog: true });
    await executeVoid();
  });

  await fails("worker cannot correct a log after 72 hours", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeCorrection({}, WORKER);
  });

  await fails("worker cannot void a log after 72 hours", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeVoid(WORKER);
  });

  await fails("correction cannot reassign the official actor", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeCorrection({
      staffId: OTHER_ADMIN.staffId,
      staffEmail: OTHER_ADMIN.email,
    });
  });

  for (const workflow of ["order", "return", "uncharged_report"]) {
    await fails(`customer ${workflow} workflow cannot create recovery`, async () => {
      await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
      await executeOperationBatch({
        size: 1,
        kind: "recovery",
        logOverrides: {
          source: workflow === "order"
            ? "order_fulfillment"
            : workflow === "return"
              ? "return_tag_processing"
              : "portal",
          workflow,
          transactionId: `${workflow}-transaction`,
        },
      });
    });
  }

  await fails("order_lend action cannot create recovery", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { action: "order_lend" },
    });
  });

  await fails("recovery visible action must match transitionAction", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { action: "fill" },
    });
  });

  await fails("transactionId cannot accompany staff-direct recovery", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transactionId: "unexpected-transaction" },
    });
  });

  await succeeds("customer transaction direct operation remains allowed under advisory setting", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      policyMode: "advisory",
      policyRevision: 2,
      logOverrides: {
        source: "order_fulfillment",
        workflow: "order",
        transactionId: "order-transaction",
      },
    });
  });

  await succeeds("order_lend direct operation requires the order transaction context", async () => {
    await resetAndSeed({
      size: 1,
      policyMode: "advisory",
      policyRevision: 2,
      tankState: "filled",
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      policyMode: "advisory",
      policyRevision: 2,
      logOverrides: directOrderLendOverrides(true),
    });
  });

  await fails("manual context cannot spoof an order_lend direct operation", async () => {
    await resetAndSeed({
      size: 1,
      policyMode: "strict",
      policyRevision: 1,
      tankState: "filled",
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: directOrderLendOverrides(false),
    });
  });

  await fails("recovery evidence shortage is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { recoveryEvidence: { physicalTankConfirmed: true } },
    });
  });

  await fails("recovery step with malformed businessEffect is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[1] = { ...plan.steps[1], businessEffect: "state_only" };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("recovery system step with malformed transition is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[0] = { ...plan.steps[0], toStatus: "damaged" };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("recovery system step with malformed businessEffect is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[0] = { ...plan.steps[0], businessEffect: "rental_open", ...CUSTOMER };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("recovery system step with an extra field is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[0] = { ...plan.steps[0], unexpected: true };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("recovery step with an empty location is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[1] = { ...plan.steps[1], location: "" };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("recovery rental-open step without a customer is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[1] = { ...plan.steps[1], customerId: "" };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("plan final location must match the next tank snapshot", async () => {
    await resetAndSeed({ size: 1, policyMode: "strict", policyRevision: 1 });
    const plan = directPlan();
    plan.steps[0] = { ...plan.steps[0], location: "別倉庫" };
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("rental-open customer must match the next tank snapshot", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    const plan = recoveryPlan();
    plan.steps[1] = { ...plan.steps[1], ...OTHER_CUSTOMER };
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { transitionPlan: plan },
    });
  });

  await fails("rental-close customer must match the previous tank snapshot", async () => {
    await resetAndSeed({
      size: 1,
      policyMode: "strict",
      policyRevision: 1,
      tankState: "lent",
      tankCustomer: CUSTOMER,
    });
    await executeOperationBatch({
      size: 1,
      kind: "direct",
      logOverrides: directReturnOverrides(OTHER_CUSTOMER),
    });
  });

  await fails("malformed recovery fingerprint is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { recoveryConfirmationFingerprint: "not-the-confirmed-fingerprint" },
    });
  });

  await fails("worker policy update is rejected", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await updatePolicyAs(WORKER, "advisory", 2);
  });

  await fails("review event is append-only", async () => {
    await resetAndSeed({ size: 0, policyMode: "advisory", policyRevision: 2 });
    await seedPendingRecoveries(1);
    await executeReviewBatch({ size: 1, decision: "approved", actor: ADMIN });
    const firestore = contextFor(ADMIN);
    await updateDoc(doc(firestore, "operationReviewEvents", "review-event"), {
      reason: "改ざんされた理由",
    });
  });
}

async function resetAndSeed({
  size,
  policyMode,
  policyRevision,
  tankState = "empty",
  tankCustomer = null,
}) {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      seedStaff(firestore, ADMIN),
      seedStaff(firestore, OTHER_ADMIN),
      seedStaff(firestore, WORKER),
      setDoc(doc(firestore, "settings", "tankOperationPolicy"), {
        transitionEnforcement: policyMode,
        policyRevision,
        updatedAt: new Date(0),
        updatedByStaffId: ADMIN.staffId,
        updatedByStaffName: ADMIN.name,
      }),
      setDoc(doc(firestore, "settings", "tankAggregationRevision"), revisionDocument({
        tankDataRevision: 5,
        officialAggregationRevision: 3,
        revisionChangeKind: "operation",
        changedLogIds: ["seed-log"],
        officialAggregationLogIds: ["seed-log"],
      })),
    ]);
    await Promise.all(Array.from({ length: size }, (_, index) => (
      setDoc(doc(firestore, "tanks", tankId(index)), tankDocument({
        status: tankState,
        customer: tankCustomer,
        latestLogId: tankState === "empty" ? null : `previous-${tankId(index)}`,
      }))
    )));
  });
}

async function seedRawPolicy(policy) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "settings", "tankOperationPolicy"), {
      ...policy,
      updatedAt: new Date(0),
      updatedByStaffId: ADMIN.staffId,
      updatedByStaffName: ADMIN.name,
    });
  });
}

async function seedMaintenanceProjection(tankIdValue, fields) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "tanks", tankIdValue), fields, { merge: true });
  });
}

function seedStaff(firestore, staff) {
  return Promise.all([
    setDoc(doc(firestore, "staffByEmail", staff.email), {
      email: staff.email,
      staffId: staff.staffId,
      name: staff.name,
      isActive: true,
      role: staff.role,
    }),
    setDoc(doc(firestore, "staff", staff.staffId), {
      id: staff.staffId,
      email: staff.email,
      name: staff.name,
      isActive: true,
      role: staff.role,
    }),
  ]);
}

function contextFor(actor) {
  return testEnvironment.authenticatedContext(actor.uid, { email: actor.email }).firestore();
}

function tankDocument({
  status,
  customer = null,
  latestLogId = null,
  staff = null,
  logNote = "",
  maintenanceDate,
  nextMaintenanceDate,
}) {
  const location = customer?.customerName ?? WAREHOUSE;
  return {
    status,
    location,
    customerId: customer?.customerId ?? null,
    customerName: customer?.customerName ?? null,
    ...(staff ? { staff } : {}),
    logNote,
    latestLogId,
    ...(maintenanceDate !== undefined ? { maintenanceDate } : {}),
    ...(nextMaintenanceDate !== undefined ? { nextMaintenanceDate } : {}),
  };
}

function tankSnapshot({
  status,
  customer = null,
  staff = null,
  logNote = "",
  location,
  maintenanceDate,
  nextMaintenanceDate,
}) {
  return {
    status,
    location: location ?? customer?.customerName ?? WAREHOUSE,
    customerId: customer?.customerId ?? null,
    customerName: customer?.customerName ?? null,
    ...(staff ? { staff } : {}),
    logNote,
    ...(maintenanceDate !== undefined ? { maintenanceDate } : {}),
    ...(nextMaintenanceDate !== undefined ? { nextMaintenanceDate } : {}),
  };
}

function revisionDocument({
  tankDataRevision,
  officialAggregationRevision,
  revisionChangeKind,
  changedLogIds,
  officialAggregationLogIds,
  reviewDecision = null,
  reviewEventId = null,
  affectedCustomerIds = [],
  timestamp = new Date(0),
}) {
  return {
    tankDataRevision,
    officialAggregationRevision,
    updatedAt: timestamp,
    revisionChangeKind,
    changedLogIds,
    officialAggregationLogIds,
    reviewDecision,
    reviewEventId,
    affectedCustomerIds,
    hasUnknownAffectedCustomer: false,
  };
}

function directPlan(action = "fill", fromStatus = "empty", toStatus = "filled") {
  return {
    version: 1,
    kind: "direct",
    steps: [{
      action,
      fromStatus,
      toStatus,
      actorType: "operator",
      businessEffect: action === "lend" ? "rental_open" : "state_only",
      ...(action === "lend" ? CUSTOMER : {}),
      location: action === "lend" ? CUSTOMER.customerName : WAREHOUSE,
    }],
    requiredEvidence: [],
  };
}

function recoveryPlan() {
  return {
    version: 1,
    kind: "recovery",
    steps: [
      {
        action: "fill",
        fromStatus: "empty",
        toStatus: "filled",
        actorType: "system",
        businessEffect: "state_only",
        location: WAREHOUSE,
      },
      {
        action: "lend",
        fromStatus: "filled",
        toStatus: "lent",
        actorType: "operator",
        businessEffect: "rental_open",
        ...CUSTOMER,
        location: CUSTOMER.customerName,
      },
    ],
    requiredEvidence: ["physicalTankConfirmed", "fillStateConfirmed"],
  };
}

function recoveryRelendPlan() {
  return {
    version: 1,
    kind: "recovery",
    steps: [
      {
        action: "return",
        fromStatus: "lent",
        toStatus: "empty",
        actorType: "system",
        businessEffect: "rental_close",
        ...CUSTOMER,
        location: WAREHOUSE,
      },
      {
        action: "fill",
        fromStatus: "empty",
        toStatus: "filled",
        actorType: "system",
        businessEffect: "state_only",
        location: WAREHOUSE,
      },
      {
        action: "lend",
        fromStatus: "filled",
        toStatus: "lent",
        actorType: "operator",
        businessEffect: "rental_open",
        ...OTHER_CUSTOMER,
        location: OTHER_CUSTOMER.customerName,
      },
    ],
    requiredEvidence: [
      "physicalTankConfirmed",
      "possessionConfirmed",
      "previousCustomerConfirmed",
      "fillStateConfirmed",
    ],
  };
}

function recoveryInHouseLendPlan() {
  return {
    version: 1,
    kind: "recovery",
    steps: [
      {
        action: "inhouse_return",
        fromStatus: "in_house",
        toStatus: "empty",
        actorType: "system",
        businessEffect: "state_only",
        location: WAREHOUSE,
      },
      {
        action: "fill",
        fromStatus: "empty",
        toStatus: "filled",
        actorType: "system",
        businessEffect: "state_only",
        location: WAREHOUSE,
      },
      {
        action: "lend",
        fromStatus: "filled",
        toStatus: "lent",
        actorType: "operator",
        businessEffect: "rental_open",
        ...CUSTOMER,
        location: CUSTOMER.customerName,
      },
    ],
    requiredEvidence: [
      "physicalTankConfirmed",
      "possessionConfirmed",
      "fillStateConfirmed",
    ],
  };
}

function directReturnOverrides(planCustomer) {
  const prevTankSnapshot = tankSnapshot({ status: "lent", customer: CUSTOMER });
  const nextTankSnapshot = tankSnapshot({ status: "empty", staff: ADMIN.name });
  return {
    action: "return",
    transitionAction: "return",
    prevStatus: "lent",
    newStatus: "empty",
    location: WAREHOUSE,
    ...CUSTOMER,
    transitionPlan: {
      version: 1,
      kind: "direct",
      steps: [{
        action: "return",
        fromStatus: "lent",
        toStatus: "empty",
        actorType: "operator",
        businessEffect: "rental_close",
        ...planCustomer,
        location: WAREHOUSE,
      }],
      requiredEvidence: [],
    },
    affectedCustomerIds: [CUSTOMER.customerId],
    prevTankSnapshot,
    nextTankSnapshot,
    previousLogIdOnSameTank: "previous-T001",
  };
}

function directOrderLendOverrides(withOrderContext) {
  const prevTankSnapshot = tankSnapshot({ status: "filled" });
  const nextTankSnapshot = tankSnapshot({
    status: "lent",
    customer: CUSTOMER,
    staff: ADMIN.name,
  });
  return {
    action: "order_lend",
    transitionAction: "lend",
    prevStatus: "filled",
    newStatus: "lent",
    location: CUSTOMER.customerName,
    ...CUSTOMER,
    transitionPlan: directPlan("lend", "filled", "lent"),
    affectedCustomerIds: [CUSTOMER.customerId],
    prevTankSnapshot,
    nextTankSnapshot,
    previousLogIdOnSameTank: "previous-T001",
    ...(withOrderContext
      ? {
          source: "order_fulfillment",
          workflow: "order",
          transactionId: "order-transaction",
        }
      : {
          source: "manual",
          workflow: "tank_operation",
        }),
  };
}

function buildOperationLog({
  id,
  kind,
  policyMode,
  policyRevision,
  actor = ADMIN,
  overrides = {},
}) {
  const direct = kind === "direct";
  const prevTankSnapshot = tankSnapshot({ status: "empty" });
  const nextTankSnapshot = direct
    ? tankSnapshot({ status: "filled", staff: actor.name })
    : tankSnapshot({ status: "lent", customer: CUSTOMER, staff: actor.name });
  return {
    tankId: id,
    action: direct ? "fill" : "lend",
    transitionAction: direct ? "fill" : "lend",
    prevStatus: "empty",
    newStatus: direct ? "filled" : "lent",
    location: nextTankSnapshot.location,
    staffId: actor.staffId,
    staffName: actor.name,
    staffEmail: actor.email,
    ...(direct ? {} : CUSTOMER),
    note: "",
    logNote: "",
    transitionPlan: direct ? directPlan() : recoveryPlan(),
    transitionReviewStatus: direct ? "not_required" : "pending",
    policyMode,
    policyRevision,
    affectedCustomerIds: direct ? [] : [CUSTOMER.customerId],
    hasUnknownAffectedCustomer: false,
    ...(!direct ? {
      source: "manual",
      workflow: "tank_operation",
      recoveryReason: "Rules自動補完確認",
      recoveryEvidence: {
        physicalTankConfirmed: true,
        fillStateConfirmed: true,
      },
      recoveryConfirmationFingerprint: "a".repeat(64),
    } : {}),
    timestamp: serverTimestamp(),
    originalAt: serverTimestamp(),
    revisionCreatedAt: serverTimestamp(),
    logStatus: "active",
    logKind: "tank",
    rootLogId: `log-${id}`,
    revision: 1,
    prevTankSnapshot,
    nextTankSnapshot,
    previousLogIdOnSameTank: null,
    ...overrides,
  };
}

function executeOperationBatch({
  size,
  kind,
  policyMode = kind === "direct" ? "strict" : "advisory",
  policyRevision = kind === "direct" ? 1 : 2,
  actor = ADMIN,
  logOverrides = {},
  omitLogWrites = false,
  omitTankWrites = false,
  mismatchedLatestLogId = false,
}) {
  const firestore = contextFor(actor);
  const direct = kind === "direct";
  return runTransaction(firestore, async (transaction) => {
    const policyRef = doc(firestore, "settings", "tankOperationPolicy");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const tankRefs = Array.from({ length: size }, (_, index) => doc(firestore, "tanks", tankId(index)));
    const logRefs = tankRefs.map((_, index) => doc(firestore, "logs", `log-${tankId(index)}`));
    await Promise.all([
      transaction.get(policyRef),
      transaction.get(revisionRef),
      Promise.all(tankRefs.map((reference) => transaction.get(reference))),
    ]);
    const logIds = logRefs.map((reference) => reference.id);
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: direct ? 4 : 3,
      revisionChangeKind: "operation",
      changedLogIds: logIds,
      officialAggregationLogIds: direct ? logIds : [],
      affectedCustomerIds: direct ? [] : [CUSTOMER.customerId],
      timestamp: serverTimestamp(),
    }));
    tankRefs.forEach((tankRef, index) => {
      const id = tankId(index);
      const logRef = logRefs[index];
      const resolvedLogOverrides = typeof logOverrides === "function"
        ? logOverrides({ id, index, actor })
        : logOverrides;
      const log = buildOperationLog({
        id,
        kind,
        policyMode,
        policyRevision,
        actor,
        overrides: resolvedLogOverrides,
      });
      if (!omitLogWrites) transaction.set(logRef, log);
      if (!omitTankWrites) {
        transaction.update(tankRef, {
          ...log.nextTankSnapshot,
          latestLogId: mismatchedLatestLogId ? "wrong-log-id" : logRef.id,
          updatedAt: serverTimestamp(),
        });
      }
    });
  });
}

async function seedPendingRecoveries(size) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all(Array.from({ length: size }, (_, index) => {
      const id = tankId(index);
      const log = buildOperationLog({
        id,
        kind: "recovery",
        policyMode: "advisory",
        policyRevision: 2,
      });
      return setDoc(doc(firestore, "logs", `recovery-${id}`), {
        ...log,
        rootLogId: `recovery-${id}`,
        timestamp: new Date(1_000),
        originalAt: new Date(1_000),
        revisionCreatedAt: new Date(1_000),
      });
    }));
  });
}

function executeReviewBatch({
  size,
  decision,
  actor,
  savedActor = actor,
  eventReason = "Rules一括レビュー確認",
  logReason = eventReason,
}) {
  const firestore = contextFor(actor);
  const eventRef = doc(firestore, "operationReviewEvents", "review-event");
  const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
  const logRefs = Array.from({ length: size }, (_, index) => (
    doc(firestore, "logs", `recovery-${tankId(index)}`)
  ));
  return runTransaction(firestore, async (transaction) => {
    await Promise.all([
      transaction.get(revisionRef),
      Promise.all(logRefs.map((reference) => transaction.get(reference))),
    ]);
    const logIds = logRefs.map((reference) => reference.id).sort();
    const official = decision === "approved";
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: official ? 4 : 3,
      revisionChangeKind: "review",
      changedLogIds: logIds,
      officialAggregationLogIds: official ? logIds : [],
      reviewDecision: decision,
      reviewEventId: eventRef.id,
      affectedCustomerIds: [CUSTOMER.customerId],
      timestamp: serverTimestamp(),
    }));
    transaction.set(eventRef, {
      eventKind: "transition_aggregation_review_batch",
      logIds,
      decision,
      reason: eventReason,
      reviewedAt: serverTimestamp(),
      reviewedByStaffId: savedActor.staffId,
      reviewedByStaffName: savedActor.name,
      reviewedByUid: savedActor.uid,
      reviewedByEmail: savedActor.email,
      affectedCustomerIds: [CUSTOMER.customerId],
      hasUnknownAffectedCustomer: false,
      requiresAggregationRebuild: official,
      entries: logIds.map((logId) => ({ logId })),
    });
    logRefs.forEach((reference) => {
      transaction.update(reference, {
        transitionReviewStatus: decision,
        reviewedAt: serverTimestamp(),
        reviewedByStaffId: savedActor.staffId,
        reviewedByStaffName: savedActor.name,
        reviewedByUid: savedActor.uid,
        reviewedByEmail: savedActor.email,
        reviewReason: logReason,
        reviewEventId: eventRef.id,
      });
    });
  });
}

async function seedActiveDirectLog({ revisionCreatedAt = new Date(1_000) } = {}) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const id = "T001";
    const prevTankSnapshot = tankSnapshot({ status: "empty" });
    const nextTankSnapshot = tankSnapshot({ status: "filled", staff: ADMIN.name });
    await Promise.all([
      setDoc(doc(firestore, "logs", "active-log"), {
        ...buildOperationLog({
          id,
          kind: "direct",
          policyMode: "strict",
          policyRevision: 1,
        }),
        rootLogId: "active-log",
        timestamp: new Date(1_000),
        originalAt: new Date(1_000),
        revisionCreatedAt,
        prevTankSnapshot,
        nextTankSnapshot,
      }),
      setDoc(doc(firestore, "tanks", id), {
        ...nextTankSnapshot,
        latestLogId: "active-log",
      }),
    ]);
  });
}

async function seedActiveRecoveryLog({ withLaterActiveLog = false } = {}) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const id = "T001";
    const recoveryLog = {
      ...buildOperationLog({
        id,
        kind: "recovery",
        policyMode: "advisory",
        policyRevision: 2,
      }),
      rootLogId: "active-log",
      timestamp: new Date(1_000),
      originalAt: new Date(1_000),
      revisionCreatedAt: new Date(1_000),
    };
    const laterLog = {
      ...buildOperationLog({
        id,
        kind: "direct",
        policyMode: "advisory",
        policyRevision: 2,
      }),
      ...directReturnOverrides(CUSTOMER),
      rootLogId: "later-log",
      timestamp: new Date(2_000),
      originalAt: new Date(2_000),
      revisionCreatedAt: new Date(2_000),
      previousLogIdOnSameTank: "active-log",
    };
    const writes = [
      setDoc(doc(firestore, "logs", "active-log"), recoveryLog),
      setDoc(doc(firestore, "tanks", id), {
        ...(withLaterActiveLog ? laterLog.nextTankSnapshot : recoveryLog.nextTankSnapshot),
        latestLogId: withLaterActiveLog ? "later-log" : "active-log",
      }),
    ];
    if (withLaterActiveLog) {
      writes.push(setDoc(doc(firestore, "logs", "later-log"), laterLog));
    }
    await Promise.all(writes);
  });
}

async function seedCrossTankCorrectionFixture() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const oldPrevTankSnapshot = tankSnapshot({
      status: "empty",
      maintenanceDate: OLD_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: OLD_TANK_NEXT_MAINTENANCE_DATE,
    });
    const oldNextTankSnapshot = tankSnapshot({
      status: "filled",
      staff: ADMIN.name,
      maintenanceDate: OLD_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: OLD_TANK_NEXT_MAINTENANCE_DATE,
    });
    const newPrevTankSnapshot = tankSnapshot({
      status: "empty",
      maintenanceDate: NEW_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: NEW_TANK_NEXT_MAINTENANCE_DATE,
    });
    await Promise.all([
      setDoc(doc(firestore, "logs", "active-log"), {
        ...buildOperationLog({
          id: "T001",
          kind: "direct",
          policyMode: "strict",
          policyRevision: 1,
        }),
        rootLogId: "active-log",
        timestamp: new Date(1_000),
        originalAt: new Date(1_000),
        revisionCreatedAt: new Date(1_000),
        prevTankSnapshot: oldPrevTankSnapshot,
        nextTankSnapshot: oldNextTankSnapshot,
      }),
      setDoc(doc(firestore, "tanks", "T001"), {
        ...oldNextTankSnapshot,
        latestLogId: "active-log",
      }),
      setDoc(doc(firestore, "tanks", "T002"), {
        ...newPrevTankSnapshot,
        latestLogId: null,
      }),
    ]);
  });
}

function executeVoid(actor = ADMIN) {
  const firestore = contextFor(actor);
  return runTransaction(firestore, async (transaction) => {
    const logRef = doc(firestore, "logs", "active-log");
    const tankRef = doc(firestore, "tanks", "T001");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const [logSnapshot] = await Promise.all([
      transaction.get(logRef),
      transaction.get(tankRef),
      transaction.get(revisionRef),
    ]);
    const log = logSnapshot.data();
    const officialChanged = ["not_required", "approved"].includes(
      log.transitionReviewStatus,
    );
    transaction.update(logRef, {
      logStatus: "voided",
      voidReason: "Rules取消操作確認",
      voidedAt: serverTimestamp(),
      voidedByStaffId: actor.staffId,
      voidedByStaffName: actor.name,
      voidedByStaffEmail: actor.email,
    });
    transaction.update(tankRef, {
      ...logSnapshot.data().prevTankSnapshot,
      staff: deleteField(),
      latestLogId: null,
      updatedAt: serverTimestamp(),
    });
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: officialChanged ? 4 : 3,
      revisionChangeKind: "void",
      changedLogIds: [logRef.id],
      officialAggregationLogIds: officialChanged ? [logRef.id] : [],
      timestamp: serverTimestamp(),
    }));
  });
}

function executeRecoveryAfterVoid() {
  const firestore = contextFor(ADMIN);
  return runTransaction(firestore, async (transaction) => {
    const policyRef = doc(firestore, "settings", "tankOperationPolicy");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const tankRef = doc(firestore, "tanks", "T001");
    const logRef = doc(firestore, "logs", "rerun-recovery-log");
    await Promise.all([
      transaction.get(policyRef),
      transaction.get(revisionRef),
      transaction.get(tankRef),
    ]);
    const log = buildOperationLog({
      id: "T001",
      kind: "recovery",
      policyMode: "advisory",
      policyRevision: 2,
      overrides: {
        rootLogId: logRef.id,
        previousLogIdOnSameTank: null,
        recoveryConfirmationFingerprint: "b".repeat(64),
      },
    });
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 7,
      officialAggregationRevision: 3,
      revisionChangeKind: "operation",
      changedLogIds: [logRef.id],
      officialAggregationLogIds: [],
      affectedCustomerIds: [CUSTOMER.customerId],
      timestamp: serverTimestamp(),
    }));
    transaction.set(logRef, log);
    transaction.update(tankRef, {
      ...log.nextTankSnapshot,
      latestLogId: logRef.id,
      updatedAt: serverTimestamp(),
    });
  });
}

function executeCorrection(newLogOverrides = {}, actor = ADMIN) {
  const firestore = contextFor(actor);
  return runTransaction(firestore, async (transaction) => {
    const oldLogRef = doc(firestore, "logs", "active-log");
    const newLogRef = doc(firestore, "logs", "corrected-log");
    const tankRef = doc(firestore, "tanks", "T001");
    const policyRef = doc(firestore, "settings", "tankOperationPolicy");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const [oldLogSnapshot] = await Promise.all([
      transaction.get(oldLogRef),
      transaction.get(tankRef),
      transaction.get(policyRef),
      transaction.get(revisionRef),
    ]);
    const oldLog = oldLogSnapshot.data();
    transaction.update(oldLogRef, {
      logStatus: "superseded",
      supersededByLogId: newLogRef.id,
    });
    transaction.set(newLogRef, {
      ...oldLog,
      note: "訂正済み",
      rootLogId: oldLogRef.id,
      revision: 2,
      supersedesLogId: oldLogRef.id,
      revisionCreatedAt: serverTimestamp(),
      editedByStaffId: actor.staffId,
      editedByStaffName: actor.name,
      editedByStaffEmail: actor.email,
      editReason: "Rules訂正操作確認",
      ...newLogOverrides,
    });
    transaction.update(tankRef, {
      ...oldLog.nextTankSnapshot,
      latestLogId: newLogRef.id,
      updatedAt: serverTimestamp(),
    });
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: 4,
      revisionChangeKind: "correction",
      changedLogIds: [newLogRef.id, oldLogRef.id],
      officialAggregationLogIds: [newLogRef.id, oldLogRef.id],
      timestamp: serverTimestamp(),
    }));
  });
}

function executeCrossTankCorrection() {
  const firestore = contextFor(ADMIN);
  return runTransaction(firestore, async (transaction) => {
    const oldLogRef = doc(firestore, "logs", "active-log");
    const newLogRef = doc(firestore, "logs", "cross-tank-corrected-log");
    const oldTankRef = doc(firestore, "tanks", "T001");
    const newTankRef = doc(firestore, "tanks", "T002");
    const policyRef = doc(firestore, "settings", "tankOperationPolicy");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const [oldLogSnapshot] = await Promise.all([
      transaction.get(oldLogRef),
      transaction.get(oldTankRef),
      transaction.get(newTankRef),
      transaction.get(policyRef),
      transaction.get(revisionRef),
    ]);
    const oldLog = oldLogSnapshot.data();
    const newPrevTankSnapshot = tankSnapshot({
      status: "empty",
      maintenanceDate: NEW_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: NEW_TANK_NEXT_MAINTENANCE_DATE,
    });
    const newNextTankSnapshot = tankSnapshot({
      status: "filled",
      staff: ADMIN.name,
      maintenanceDate: NEW_TANK_MAINTENANCE_DATE,
      nextMaintenanceDate: NEW_TANK_NEXT_MAINTENANCE_DATE,
    });

    transaction.update(oldLogRef, {
      logStatus: "superseded",
      supersededByLogId: newLogRef.id,
    });
    transaction.set(newLogRef, {
      ...oldLog,
      tankId: "T002",
      note: "別タンクへ訂正済み",
      transitionPlan: directPlan(),
      prevStatus: "empty",
      newStatus: "filled",
      rootLogId: oldLogRef.id,
      revision: 2,
      supersedesLogId: oldLogRef.id,
      revisionCreatedAt: serverTimestamp(),
      editedByStaffId: ADMIN.staffId,
      editedByStaffName: ADMIN.name,
      editedByStaffEmail: ADMIN.email,
      editReason: "Rules別タンク訂正確認",
      prevTankSnapshot: newPrevTankSnapshot,
      nextTankSnapshot: newNextTankSnapshot,
      previousLogIdOnSameTank: null,
    });
    transaction.update(oldTankRef, {
      ...oldLog.prevTankSnapshot,
      staff: deleteField(),
      latestLogId: null,
      updatedAt: serverTimestamp(),
    });
    transaction.update(newTankRef, {
      ...newNextTankSnapshot,
      latestLogId: newLogRef.id,
      updatedAt: serverTimestamp(),
    });
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: 4,
      revisionChangeKind: "correction",
      changedLogIds: [newLogRef.id, oldLogRef.id],
      officialAggregationLogIds: [newLogRef.id, oldLogRef.id],
      timestamp: serverTimestamp(),
    }));
  });
}

function updatePolicyAs(actor, transitionEnforcement, policyRevision) {
  const firestore = contextFor(actor);
  return setDoc(doc(firestore, "settings", "tankOperationPolicy"), {
    transitionEnforcement,
    policyRevision,
    updatedAt: serverTimestamp(),
    updatedByStaffId: actor.staffId,
    updatedByStaffName: actor.name,
  });
}

async function seedResolvedRecovery(status) {
  await seedPendingRecoveries(1);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "logs", "recovery-T001"), {
      transitionReviewStatus: status,
      reviewedAt: new Date(2_000),
      reviewedByStaffId: ADMIN.staffId,
      reviewedByStaffName: ADMIN.name,
      reviewedByUid: ADMIN.uid,
      reviewedByEmail: ADMIN.email,
      reviewReason: "過去の判断理由",
      reviewEventId: "past-review-event",
    });
  });
}

function updateTerminalReview(nextStatus) {
  const firestore = contextFor(ADMIN);
  return updateDoc(doc(firestore, "logs", "recovery-T001"), {
    transitionReviewStatus: nextStatus,
  });
}

function updatePlanAsAdmin() {
  const firestore = contextFor(ADMIN);
  return updateDoc(doc(firestore, "logs", "recovery-T001"), {
    "transitionPlan.requiredEvidence": [],
  });
}

function updateRevisionOnly() {
  const firestore = contextFor(WORKER);
  return setDoc(doc(firestore, "settings", "tankAggregationRevision"), revisionDocument({
    tankDataRevision: 6,
    officialAggregationRevision: 4,
    revisionChangeKind: "operation",
    changedLogIds: ["active-log"],
    officialAggregationLogIds: ["active-log"],
    timestamp: serverTimestamp(),
  }));
}

async function succeeds(label, operation) {
  await assertSucceeds(operation());
  process.stdout.write(`PASS ${label}\n`);
}

async function fails(label, operation) {
  await assertFails(operation());
  process.stdout.write(`PASS reject: ${label}\n`);
}

function tankId(index) {
  return `T${String(index + 1).padStart(3, "0")}`;
}
