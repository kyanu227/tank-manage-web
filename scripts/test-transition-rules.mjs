import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
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
  customerName: "別顧客",
};
const WAREHOUSE = "倉庫";

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

  for (const size of [1, 10, 50, 100]) {
    await succeeds(`advisory recovery operation: ${size}`, async () => {
      await resetAndSeed({ size, policyMode: "advisory", policyRevision: 2 });
      await executeOperationBatch({ size, kind: "recovery" });
    });
  }

  for (const size of [1, 10]) {
    await succeeds(`return transaction coupled operation: ${size}`, async () => {
      await seedReturnBatch(size);
      await executeReturnBatch(size);
    });
  }

  for (const size of [50, 100]) {
    await fails(`return transaction exceeds verified Rules budget: ${size}`, async () => {
      await seedReturnBatch(size);
      await executeReturnBatch(size);
    });
  }

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

  await succeeds("valid void", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeVoid();
  });

  await succeeds("valid correction", async () => {
    await resetAndSeed({ size: 0, policyMode: "strict", policyRevision: 1 });
    await seedActiveDirectLog();
    await executeCorrection();
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

  await fails("return transaction customer mismatch is rejected", async () => {
    await resetAndSeed({
      size: 1,
      policyMode: "strict",
      policyRevision: 1,
      tankState: "lent",
      tankCustomer: CUSTOMER,
    });
    await executeMismatchedReturn();
  });

  await fails("recovery evidence shortage is rejected", async () => {
    await resetAndSeed({ size: 1, policyMode: "advisory", policyRevision: 2 });
    await executeOperationBatch({
      size: 1,
      kind: "recovery",
      logOverrides: { recoveryEvidence: { physicalTankConfirmed: true } },
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

function tankDocument({ status, customer = null, latestLogId = null, staff = null, logNote = "" }) {
  const location = customer?.customerName ?? WAREHOUSE;
  return {
    status,
    location,
    customerId: customer?.customerId ?? null,
    customerName: customer?.customerName ?? null,
    ...(staff ? { staff } : {}),
    logNote,
    latestLogId,
  };
}

function tankSnapshot({ status, customer = null, staff = null, logNote = "", location }) {
  return {
    status,
    location: location ?? customer?.customerName ?? WAREHOUSE,
    customerId: customer?.customerId ?? null,
    customerName: customer?.customerName ?? null,
    ...(staff ? { staff } : {}),
    logNote,
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

function buildOperationLog({ id, kind, policyMode, policyRevision, overrides = {} }) {
  const direct = kind === "direct";
  const prevTankSnapshot = tankSnapshot({ status: "empty" });
  const nextTankSnapshot = direct
    ? tankSnapshot({ status: "filled", staff: ADMIN.name })
    : tankSnapshot({ status: "lent", customer: CUSTOMER, staff: ADMIN.name });
  return {
    tankId: id,
    action: direct ? "fill" : "lend",
    transitionAction: direct ? "fill" : "lend",
    prevStatus: "empty",
    newStatus: direct ? "filled" : "lent",
    location: nextTankSnapshot.location,
    staffId: ADMIN.staffId,
    staffName: ADMIN.name,
    staffEmail: ADMIN.email,
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
  logOverrides = {},
  omitLogWrites = false,
  omitTankWrites = false,
  mismatchedLatestLogId = false,
}) {
  const firestore = contextFor(ADMIN);
  const direct = kind === "direct";
  const policyMode = direct ? "strict" : "advisory";
  const policyRevision = direct ? 1 : 2;
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
      const log = buildOperationLog({
        id,
        kind,
        policyMode,
        policyRevision,
        overrides: logOverrides,
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

async function seedReturnBatch(size) {
  await resetAndSeed({
    size,
    policyMode: "strict",
    policyRevision: 1,
    tankState: "lent",
    tankCustomer: CUSTOMER,
  });
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all(Array.from({ length: size }, async (_, index) => {
      const id = tankId(index);
      await Promise.all([
        setDoc(doc(firestore, "transactions", `return-${id}`), {
          type: "return",
          status: "pending_return",
          tankId: id,
          ...CUSTOMER,
          createdAt: new Date(1_000),
        }),
        setDoc(doc(firestore, "logs", `previous-${id}`), {
          logKind: "tank",
          logStatus: "active",
          tankId: id,
          transitionReviewStatus: "not_required",
        }),
      ]);
    }));
  });
}

function executeReturnBatch(size) {
  const firestore = contextFor(ADMIN);
  return runTransaction(firestore, async (transaction) => {
    const policyRef = doc(firestore, "settings", "tankOperationPolicy");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const tankRefs = Array.from({ length: size }, (_, index) => (
      doc(firestore, "tanks", tankId(index))
    ));
    const logRefs = tankRefs.map((_, index) => (
      doc(firestore, "logs", `return-log-${tankId(index)}`)
    ));
    const returnRefs = tankRefs.map((_, index) => (
      doc(firestore, "transactions", `return-${tankId(index)}`)
    ));
    const [tankSnapshots] = await Promise.all([
      Promise.all(tankRefs.map((reference) => transaction.get(reference))),
      Promise.all(returnRefs.map((reference) => transaction.get(reference))),
      transaction.get(policyRef),
      transaction.get(revisionRef),
    ]);
    const logIds = logRefs.map((reference) => reference.id).sort();
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: 4,
      revisionChangeKind: "operation",
      changedLogIds: logIds,
      officialAggregationLogIds: logIds,
      affectedCustomerIds: [CUSTOMER.customerId],
      timestamp: serverTimestamp(),
    }));

    tankRefs.forEach((tankRef, index) => {
      const id = tankId(index);
      const logRef = logRefs[index];
      const returnRef = returnRefs[index];
      const prevTankSnapshot = tankSnapshot({ status: "lent", customer: CUSTOMER });
      const nextTankSnapshot = tankSnapshot({ status: "empty", staff: ADMIN.name });
      transaction.set(logRef, {
        tankId: id,
        action: "return",
        transitionAction: "return",
        prevStatus: "lent",
        newStatus: "empty",
        location: WAREHOUSE,
        staffId: ADMIN.staffId,
        staffName: ADMIN.name,
        staffEmail: ADMIN.email,
        ...CUSTOMER,
        transactionId: returnRef.id,
        source: "return_tag_processing",
        workflow: "return",
        returnCondition: "normal",
        note: "",
        logNote: "",
        transitionPlan: {
          version: 1,
          kind: "direct",
          steps: [{
            action: "return",
            fromStatus: "lent",
            toStatus: "empty",
            actorType: "operator",
            businessEffect: "rental_close",
            ...CUSTOMER,
            location: WAREHOUSE,
          }],
          requiredEvidence: [],
        },
        transitionReviewStatus: "not_required",
        policyMode: "strict",
        policyRevision: 1,
        affectedCustomerIds: [CUSTOMER.customerId],
        hasUnknownAffectedCustomer: false,
        timestamp: serverTimestamp(),
        originalAt: serverTimestamp(),
        revisionCreatedAt: serverTimestamp(),
        logStatus: "active",
        logKind: "tank",
        rootLogId: logRef.id,
        revision: 1,
        prevTankSnapshot,
        nextTankSnapshot,
        previousLogIdOnSameTank: tankSnapshots[index].data().latestLogId,
      });
      transaction.update(tankRef, {
        ...nextTankSnapshot,
        latestLogId: logRef.id,
        updatedAt: serverTimestamp(),
      });
      transaction.update(returnRef, {
        status: "completed",
        finalCondition: "normal",
        fulfilledAt: serverTimestamp(),
        fulfilledBy: ADMIN.name,
        fulfilledByStaffId: ADMIN.staffId,
        fulfilledByStaffName: ADMIN.name,
        fulfilledByStaffEmail: ADMIN.email,
        fulfilledLogId: logRef.id,
      });
    });
  });
}

function executeReviewBatch({ size, decision, actor, savedActor = actor }) {
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
      reason: "Rules一括レビュー確認",
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
        reviewReason: "Rules一括レビュー確認",
        reviewEventId: eventRef.id,
      });
    });
  });
}

async function seedActiveDirectLog() {
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
        revisionCreatedAt: new Date(1_000),
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

function executeVoid() {
  const firestore = contextFor(ADMIN);
  return runTransaction(firestore, async (transaction) => {
    const logRef = doc(firestore, "logs", "active-log");
    const tankRef = doc(firestore, "tanks", "T001");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    const [logSnapshot] = await Promise.all([
      transaction.get(logRef),
      transaction.get(tankRef),
      transaction.get(revisionRef),
    ]);
    transaction.update(logRef, {
      logStatus: "voided",
      voidReason: "Rules取消操作確認",
      voidedAt: serverTimestamp(),
      voidedByStaffId: ADMIN.staffId,
      voidedByStaffName: ADMIN.name,
      voidedByStaffEmail: ADMIN.email,
    });
    transaction.update(tankRef, {
      ...logSnapshot.data().prevTankSnapshot,
      staff: deleteField(),
      latestLogId: null,
      updatedAt: serverTimestamp(),
    });
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: 4,
      revisionChangeKind: "void",
      changedLogIds: [logRef.id],
      officialAggregationLogIds: [logRef.id],
      timestamp: serverTimestamp(),
    }));
  });
}

function executeCorrection() {
  const firestore = contextFor(ADMIN);
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
      editedByStaffId: ADMIN.staffId,
      editedByStaffName: ADMIN.name,
      editedByStaffEmail: ADMIN.email,
      editReason: "Rules訂正操作確認",
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

function executeMismatchedReturn() {
  const firestore = contextFor(ADMIN);
  return runTransaction(firestore, async (transaction) => {
    const tankRef = doc(firestore, "tanks", "T001");
    const logRef = doc(firestore, "logs", "mismatched-return-log");
    const revisionRef = doc(firestore, "settings", "tankAggregationRevision");
    await Promise.all([
      transaction.get(doc(firestore, "settings", "tankOperationPolicy")),
      transaction.get(revisionRef),
      transaction.get(tankRef),
    ]);
    const prevTankSnapshot = tankSnapshot({ status: "lent", customer: CUSTOMER });
    const nextTankSnapshot = tankSnapshot({ status: "empty", staff: ADMIN.name });
    transaction.set(logRef, {
      tankId: "T001",
      action: "return",
      transitionAction: "return",
      prevStatus: "lent",
      newStatus: "empty",
      location: WAREHOUSE,
      staffId: ADMIN.staffId,
      staffName: ADMIN.name,
      staffEmail: ADMIN.email,
      ...OTHER_CUSTOMER,
      transactionId: "return-request-a",
      workflow: "return",
      transitionPlan: {
        version: 1,
        kind: "direct",
        steps: [{
          action: "return",
          fromStatus: "lent",
          toStatus: "empty",
          actorType: "operator",
          businessEffect: "rental_close",
          ...CUSTOMER,
          location: WAREHOUSE,
        }],
        requiredEvidence: [],
      },
      transitionReviewStatus: "not_required",
      policyMode: "strict",
      policyRevision: 1,
      affectedCustomerIds: [CUSTOMER.customerId, OTHER_CUSTOMER.customerId],
      hasUnknownAffectedCustomer: false,
      timestamp: serverTimestamp(),
      originalAt: serverTimestamp(),
      revisionCreatedAt: serverTimestamp(),
      logStatus: "active",
      logKind: "tank",
      rootLogId: logRef.id,
      revision: 1,
      prevTankSnapshot,
      nextTankSnapshot,
      previousLogIdOnSameTank: "previous-T001",
    });
    transaction.update(tankRef, {
      ...nextTankSnapshot,
      latestLogId: logRef.id,
      updatedAt: serverTimestamp(),
    });
    transaction.set(revisionRef, revisionDocument({
      tankDataRevision: 6,
      officialAggregationRevision: 4,
      revisionChangeKind: "operation",
      changedLogIds: [logRef.id],
      officialAggregationLogIds: [logRef.id],
      affectedCustomerIds: [CUSTOMER.customerId, OTHER_CUSTOMER.customerId],
      timestamp: serverTimestamp(),
    }));
  });
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
