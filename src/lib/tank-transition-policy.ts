import {
  isTankActionCode,
  isTankStatusCode,
  type TankActionCode,
  type TankStatusCode,
} from "@/lib/tank-action-status-codes";
import {
  getNextStatusCode,
  validateTransitionCode,
  type TankOperationActionCode,
} from "@/lib/tank-rules";

export const TRANSITION_ENFORCEMENT_MODES = ["strict", "advisory"] as const;
export type TransitionEnforcementMode = (typeof TRANSITION_ENFORCEMENT_MODES)[number];

export const TRANSITION_REVIEW_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "excluded",
] as const;
export type TransitionReviewStatus = (typeof TRANSITION_REVIEW_STATUSES)[number];

export type TankOperationPolicy = {
  transitionEnforcement: TransitionEnforcementMode;
  policyRevision: number;
  updatedAt?: unknown;
  updatedByStaffId?: string;
  updatedByStaffName?: string;
};

export const DEFAULT_TANK_OPERATION_POLICY: Readonly<TankOperationPolicy> = {
  transitionEnforcement: "strict",
  policyRevision: 0,
};

export type TransitionBusinessEffect = "state_only" | "rental_open" | "rental_close";
export type TransitionStepActorType = "system" | "operator";

export const RECOVERY_EVIDENCE_KEYS = [
  "physicalTankConfirmed",
  "possessionConfirmed",
  "previousCustomerConfirmed",
  "fillStateConfirmed",
  "damageStateConfirmed",
] as const;
export type RecoveryEvidenceKey = (typeof RECOVERY_EVIDENCE_KEYS)[number];
export type RecoveryEvidence = Partial<Record<RecoveryEvidenceKey, true>>;

export type TransitionStep = {
  /** 保存値はTankActionCode。plannerは状態遷移用に正規化したactionだけを生成する。 */
  action: TankActionCode;
  fromStatus: TankStatusCode;
  toStatus: TankStatusCode;
  actorType: TransitionStepActorType;
  businessEffect: TransitionBusinessEffect;
  customerId?: string;
  customerName?: string;
  location?: string;
};

export type TransitionPlan = {
  version: 1;
  kind: "direct" | "recovery";
  steps: TransitionStep[];
  requiredEvidence: RecoveryEvidenceKey[];
};

export type TransitionCustomerSnapshot = {
  customerId: string;
  customerName: string;
};

export type TransitionPlannerState = {
  status: TankStatusCode;
  customerId?: string | null;
  customerName?: string | null;
  location?: string | null;
};

export type TransitionPlanRequest = {
  policyMode: TransitionEnforcementMode;
  current: TransitionPlannerState;
  requestedAction: TankActionCode;
  targetCustomer?: TransitionCustomerSnapshot | null;
  targetLocation?: string | null;
};

export type TransitionPlanBlockCode =
  | "disposed"
  | "unsupported_action"
  | "missing_previous_customer"
  | "missing_target_customer"
  | "strict_transition_required"
  | "maintenance_direct_only"
  | "no_recovery_recipe"
  | "invalid_generated_plan";

export type TransitionPlanResult =
  | {
      ok: true;
      transitionAction: TankOperationActionCode;
      nextStatus: TankStatusCode;
      plan: TransitionPlan;
    }
  | {
      ok: false;
      code: TransitionPlanBlockCode;
      reason: string;
    };

export type TransitionPlanValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export type AffectedCustomers = {
  affectedCustomerIds: string[];
  hasUnknownAffectedCustomer: boolean;
};

export type RecoveryConfirmationFingerprintInput = {
  tankId: string;
  latestLogId?: string | null;
  status: TankStatusCode;
  location?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  requestedAction: TankActionCode;
  plan: TransitionPlan;
  policyRevision: number;
};

const BUSINESS_EFFECTS: readonly TransitionBusinessEffect[] = [
  "state_only",
  "rental_open",
  "rental_close",
];
const STEP_ACTOR_TYPES: readonly TransitionStepActorType[] = ["system", "operator"];
const MAINTENANCE_ACTIONS: readonly TankOperationActionCode[] = [
  "damage_report",
  "repaired",
  "inspection",
  "dispose",
];
const SYSTEM_RECOVERY_ACTIONS: readonly TankOperationActionCode[] = [
  "return",
  "fill",
  "inhouse_return",
];

export function isTransitionEnforcementMode(value: unknown): value is TransitionEnforcementMode {
  return TRANSITION_ENFORCEMENT_MODES.includes(value as TransitionEnforcementMode);
}

export function isTransitionReviewStatus(value: unknown): value is TransitionReviewStatus {
  return TRANSITION_REVIEW_STATUSES.includes(value as TransitionReviewStatus);
}

export function normalizeTankOperationPolicy(value: unknown): TankOperationPolicy {
  if (!isRecord(value)) return { ...DEFAULT_TANK_OPERATION_POLICY };

  const parsedMode = isTransitionEnforcementMode(value.transitionEnforcement)
    ? value.transitionEnforcement
    : null;
  const parsedRevision = isNonNegativeSafeInteger(value.policyRevision)
    ? value.policyRevision
    : null;
  const policyRevision = parsedRevision ?? 0;
  // advisoryはrevisionを持つ正常なdocumentだけで有効化する。
  // 欠落・不正documentをrevision 0のadvisoryとして扱わない。
  const transitionEnforcement = parsedMode
    && parsedRevision !== null
    && (parsedMode === "strict" || policyRevision > 0)
    ? parsedMode
    : "strict";

  return {
    transitionEnforcement,
    policyRevision,
    ...(value.updatedAt !== undefined ? { updatedAt: value.updatedAt } : {}),
    ...(isNonEmptyString(value.updatedByStaffId)
      ? { updatedByStaffId: value.updatedByStaffId.trim() }
      : {}),
    ...(isNonEmptyString(value.updatedByStaffName)
      ? { updatedByStaffName: value.updatedByStaffName.trim() }
      : {}),
  };
}

/**
 * 表示用 action の order_lend を、状態遷移の正本である lend に正規化する。
 * procurement / supply-order はtank状態遷移ではないため null を返す。
 */
export function normalizeTransitionAction(
  action: TankActionCode,
): TankOperationActionCode | null {
  if (action === "order_lend") return "lend";
  if (getNextStatusCode(action) === null) return null;
  return action as TankOperationActionCode;
}

/**
 * strict-validな直接遷移、または許可済みの通常運用recoveryだけを計画する。
 * メンテナンス操作をsystem stepとして生成することはない。
 */
export function planTankTransition(request: TransitionPlanRequest): TransitionPlanResult {
  const transitionAction = normalizeTransitionAction(request.requestedAction);
  if (!transitionAction) {
    return blocked("unsupported_action", "タンク状態遷移の対象外の操作です。");
  }

  if (request.current.status === "disposed") {
    return blocked("disposed", "破棄済みタンクは操作できません。");
  }

  const direct = validateTransitionCode(request.current.status, transitionAction);
  if (direct) {
    const stepResult = createOperatorStep(request, transitionAction, request.current.status);
    if (!stepResult.ok) return stepResult;
    return finalizePlan(request, transitionAction, {
      version: 1,
      kind: "direct",
      steps: [stepResult.step],
      requiredEvidence: [],
    });
  }

  if (request.policyMode !== "advisory") {
    return blocked(
      "strict_transition_required",
      `現在の状態「${request.current.status}」では「${transitionAction}」を実行できません。`,
    );
  }

  if (MAINTENANCE_ACTIONS.includes(transitionAction)) {
    return blocked(
      "maintenance_direct_only",
      "メンテナンス・資産管理操作は、直接遷移条件を満たす場合だけ実行できます。",
    );
  }

  const recipe = createOrdinaryRecoveryRecipe(request, transitionAction);
  if (!recipe.ok) return recipe;
  return finalizePlan(request, transitionAction, recipe.plan);
}

export function validateTransitionPlan(input: {
  plan: unknown;
  currentStatus: TankStatusCode;
  requestedAction: TankActionCode;
}): TransitionPlanValidationResult {
  if (!isTransitionPlan(input.plan)) {
    return { ok: false, reason: "transitionPlanの形式または遷移内容が不正です。" };
  }

  const transitionAction = normalizeTransitionAction(input.requestedAction);
  if (!transitionAction) {
    return { ok: false, reason: "状態遷移の対象外の操作です。" };
  }

  if (input.plan.steps[0]?.fromStatus !== input.currentStatus) {
    return { ok: false, reason: "transitionPlanの開始状態が現在状態と一致しません。" };
  }

  if (input.plan.steps.at(-1)?.action !== transitionAction) {
    return { ok: false, reason: "transitionPlanの最終actionがtransitionActionと一致しません。" };
  }

  return { ok: true };
}

export function isTransitionPlan(value: unknown): value is TransitionPlan {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!hasOnlyKeys(value, ["version", "kind", "steps", "requiredEvidence"])) return false;
  if (value.kind !== "direct" && value.kind !== "recovery") return false;
  if (!Array.isArray(value.steps) || value.steps.length === 0) return false;
  if (!Array.isArray(value.requiredEvidence)) return false;

  const evidence = value.requiredEvidence;
  if (!evidence.every(isRecoveryEvidenceKey)) return false;
  if (!isCanonicalEvidenceOrder(evidence)) return false;

  const steps = value.steps;
  if (!steps.every(isTransitionStep)) return false;
  if (steps.some((step) => step.fromStatus === "disposed")) return false;
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index - 1].toStatus !== steps[index].fromStatus) return false;
  }

  if (value.kind === "direct") {
    return steps.length === 1
      && steps[0].actorType === "operator"
      && evidence.length === 0;
  }

  const expectedEvidence = requiredEvidenceForSteps(steps);
  return steps.length >= 2
    && steps.slice(0, -1).every((step) => step.actorType === "system")
    && steps.at(-1)?.actorType === "operator"
    && evidence.length > 0
    && evidence.every((key, index) => key === expectedEvidence[index])
    && evidence.length === expectedEvidence.length
    && isInitialOrdinaryRecoveryRecipe(steps);
}

export function normalizeTransitionPlan(value: unknown): TransitionPlan | null {
  if (!isTransitionPlan(value)) return null;
  return {
    version: 1,
    kind: value.kind,
    steps: value.steps.map((step) => ({ ...step })),
    requiredEvidence: [...value.requiredEvidence],
  };
}

export function validateRecoveryEvidence(
  plan: TransitionPlan,
  evidence: RecoveryEvidence | null | undefined,
): TransitionPlanValidationResult {
  if (!isTransitionPlan(plan)) {
    return { ok: false, reason: "transitionPlanが不正です。" };
  }

  const missing = getMissingRecoveryEvidence(plan, evidence);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `必要な現物確認が完了していません: ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

export function getMissingRecoveryEvidence(
  plan: TransitionPlan,
  evidence: RecoveryEvidence | null | undefined,
): RecoveryEvidenceKey[] {
  return plan.requiredEvidence.filter((key) => evidence?.[key] !== true);
}

/** plannerが要求した確認項目だけを監査用payloadへ残す。 */
export function pickRequiredRecoveryEvidence(
  requiredEvidence: readonly RecoveryEvidenceKey[],
  evidence: RecoveryEvidence | null | undefined,
): RecoveryEvidence {
  return Object.fromEntries(
    requiredEvidence
      .filter((key) => evidence?.[key] === true)
      .map((key) => [key, true]),
  ) as RecoveryEvidence;
}

export function deriveAffectedCustomers(
  plan: TransitionPlan,
  topLevelCustomerId?: string | null,
): AffectedCustomers {
  const ids = new Set<string>();
  let hasUnknownAffectedCustomer = false;

  plan.steps.forEach((step) => {
    if (step.businessEffect === "state_only") return;
    if (isNonEmptyString(step.customerId)) {
      ids.add(step.customerId.trim());
    } else {
      hasUnknownAffectedCustomer = true;
    }
  });

  if (isNonEmptyString(topLevelCustomerId)) ids.add(topLevelCustomerId.trim());
  return {
    affectedCustomerIds: [...ids].sort(),
    hasUnknownAffectedCustomer,
  };
}

/** batchはtankId順へ正規化し、UIの表示順に依存しないcanonical JSONを返す。 */
export function buildRecoveryConfirmationCanonicalJson(
  inputs: readonly RecoveryConfirmationFingerprintInput[],
): string {
  const normalized = inputs.map(normalizeFingerprintInput).sort((left, right) => {
    if (left.tankId < right.tankId) return -1;
    if (left.tankId > right.tankId) return 1;
    return 0;
  });
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].tankId === normalized[index].tankId) {
      throw new Error(`confirmation fingerprintに同じtankIdが重複しています: ${normalized[index].tankId}`);
    }
  }
  return canonicalStringify(normalized);
}

export async function createRecoveryConfirmationFingerprint(
  inputs: readonly RecoveryConfirmationFingerprintInput[],
): Promise<string> {
  const canonical = buildRecoveryConfirmationCanonicalJson(inputs);
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256を利用できない実行環境です。");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

function createOrdinaryRecoveryRecipe(
  request: TransitionPlanRequest,
  action: TankOperationActionCode,
): { ok: true; plan: TransitionPlan } | Extract<TransitionPlanResult, { ok: false }> {
  const steps: TransitionStep[] = [];
  let status = request.current.status;

  const closeCurrentHolder = (): Extract<TransitionPlanResult, { ok: false }> | null => {
    if (status === "lent" || status === "unreturned") {
      const customer = currentCustomer(request.current);
      if (!customer) {
        return blocked(
          "missing_previous_customer",
          "現在の貸出先customerId/customerNameを確認できないため、自動返却できません。",
        );
      }
      steps.push(makeStep("return", status, "system", "rental_close", customer, "倉庫"));
      status = "empty";
      return null;
    }
    if (status === "in_house") {
      steps.push(makeStep("inhouse_return", status, "system", "state_only", null, "倉庫"));
      status = "empty";
      return null;
    }
    return null;
  };

  const fillIfEmpty = () => {
    if (status !== "empty") return;
    steps.push(makeStep("fill", status, "system", "state_only", null, "倉庫"));
    status = "filled";
  };

  if (action === "lend") {
    const customer = normalizeCustomer(request.targetCustomer);
    if (!customer) {
      return blocked(
        "missing_target_customer",
        "貸出先customerId/customerNameが必要です。",
      );
    }
    const closeError = closeCurrentHolder();
    if (closeError) return closeError;
    fillIfEmpty();
    if (status !== "filled") return noRecipe(request, action);
    steps.push(makeStep("lend", status, "operator", "rental_open", customer, targetLocation(request, customer.customerName)));
  } else if (action === "fill") {
    if (status !== "lent" && status !== "unreturned" && status !== "in_house") {
      return noRecipe(request, action);
    }
    const closeError = closeCurrentHolder();
    if (closeError) return closeError;
    steps.push(makeStep("fill", status, "operator", "state_only", null, targetLocation(request, "倉庫")));
  } else if (action === "inhouse_use" || action === "inhouse_use_retro") {
    const closeError = closeCurrentHolder();
    if (closeError) return closeError;
    fillIfEmpty();
    if (status !== "filled") return noRecipe(request, action);
    steps.push(makeStep(action, status, "operator", "state_only", null, targetLocation(request, "自社")));
  } else {
    return noRecipe(request, action);
  }

  if (steps.length < 2) return noRecipe(request, action);
  return {
    ok: true,
    plan: {
      version: 1,
      kind: "recovery",
      steps,
      requiredEvidence: requiredEvidenceForSteps(steps),
    },
  };
}

function createOperatorStep(
  request: TransitionPlanRequest,
  action: TankOperationActionCode,
  fromStatus: TankStatusCode,
): { ok: true; step: TransitionStep } | Extract<TransitionPlanResult, { ok: false }> {
  const effect = expectedBusinessEffect(action, fromStatus);
  let customer: TransitionCustomerSnapshot | null = null;

  if (effect === "rental_open") {
    customer = normalizeCustomer(request.targetCustomer);
    if (!customer) {
      return blocked("missing_target_customer", "貸出先customerId/customerNameが必要です。");
    }
  } else if (effect === "rental_close") {
    customer = currentCustomer(request.current);
    if (!customer) {
      return blocked(
        "missing_previous_customer",
        "現在の貸出先customerId/customerNameが必要です。",
      );
    }
  }

  return {
    ok: true,
    step: makeStep(
      action,
      fromStatus,
      "operator",
      effect,
      customer,
      targetLocation(request, effect === "rental_open" ? customer?.customerName ?? "" : "倉庫"),
    ),
  };
}

function finalizePlan(
  request: TransitionPlanRequest,
  transitionAction: TankOperationActionCode,
  plan: TransitionPlan,
): TransitionPlanResult {
  const validation = validateTransitionPlan({
    plan,
    currentStatus: request.current.status,
    requestedAction: transitionAction,
  });
  if (!validation.ok) {
    return blocked("invalid_generated_plan", validation.reason);
  }
  return {
    ok: true,
    transitionAction,
    nextStatus: plan.steps.at(-1)!.toStatus,
    plan,
  };
}

function makeStep(
  action: TankOperationActionCode,
  fromStatus: TankStatusCode,
  actorType: TransitionStepActorType,
  businessEffect: TransitionBusinessEffect,
  customer: TransitionCustomerSnapshot | null,
  location: string,
): TransitionStep {
  const toStatus = getNextStatusCode(action);
  if (!toStatus) throw new Error(`遷移先が未定義のactionです: ${action}`);
  return {
    action,
    fromStatus,
    toStatus,
    actorType,
    businessEffect,
    ...(customer ?? {}),
    ...(location ? { location } : {}),
  };
}

function isTransitionStep(value: unknown): value is TransitionStep {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "action",
    "fromStatus",
    "toStatus",
    "actorType",
    "businessEffect",
    "customerId",
    "customerName",
    "location",
  ])) return false;
  if (!isTankActionCode(value.action)) return false;
  const action = normalizeTransitionAction(value.action);
  if (!action || action !== value.action) return false;
  if (!isTankStatusCode(value.fromStatus) || !isTankStatusCode(value.toStatus)) return false;
  if (!STEP_ACTOR_TYPES.includes(value.actorType as TransitionStepActorType)) return false;
  if (!BUSINESS_EFFECTS.includes(value.businessEffect as TransitionBusinessEffect)) return false;
  if (!isCanonicalOptionalString(value.customerId)) return false;
  if (!isCanonicalOptionalString(value.customerName)) return false;
  if (!isCanonicalOptionalString(value.location)) return false;
  if (!validateTransitionCode(value.fromStatus, action)) return false;
  if (getNextStatusCode(action) !== value.toStatus) return false;
  if (expectedBusinessEffect(action, value.fromStatus) !== value.businessEffect) return false;
  if (value.actorType === "system" && !SYSTEM_RECOVERY_ACTIONS.includes(action)) return false;
  const hasCustomerId = typeof value.customerId === "string";
  const hasCustomerName = typeof value.customerName === "string";
  if (value.businessEffect === "state_only" && (hasCustomerId || hasCustomerName)) return false;
  if (value.businessEffect !== "state_only" && (!hasCustomerId || !hasCustomerName)) return false;
  return true;
}

function expectedBusinessEffect(
  action: TankOperationActionCode,
  fromStatus: TankStatusCode,
): TransitionBusinessEffect {
  if (action === "lend") return "rental_open";
  if (
    fromStatus !== "in_house"
    && (action === "return" || action === "return_unused" || action === "return_uncharged")
  ) {
    return "rental_close";
  }
  return "state_only";
}

/** version 1の初回リリースで許可した通常運用レシピだけを受理する。 */
function isInitialOrdinaryRecoveryRecipe(steps: readonly TransitionStep[]): boolean {
  const signature = steps
    .map((step) => `${step.fromStatus}:${step.action}:${step.actorType}:${step.toStatus}`)
    .join("|");

  const finalAction = steps.at(-1)?.action;
  const startsFromCustomer = steps[0]?.fromStatus === "lent"
    || steps[0]?.fromStatus === "unreturned";
  const startsInHouse = steps[0]?.fromStatus === "in_house";

  if (finalAction === "lend") {
    if (signature === "empty:fill:system:filled|filled:lend:operator:lent") return true;
    if (
      startsFromCustomer
      && /^((lent)|(unreturned)):return:system:empty\|empty:fill:system:filled\|filled:lend:operator:lent$/.test(signature)
    ) return true;
    return startsInHouse
      && signature === "in_house:inhouse_return:system:empty|empty:fill:system:filled|filled:lend:operator:lent";
  }

  if (finalAction === "fill") {
    if (
      startsFromCustomer
      && /^((lent)|(unreturned)):return:system:empty\|empty:fill:operator:filled$/.test(signature)
    ) return true;
    return startsInHouse
      && signature === "in_house:inhouse_return:system:empty|empty:fill:operator:filled";
  }

  if (finalAction === "inhouse_use" || finalAction === "inhouse_use_retro") {
    const suffix = `filled:${finalAction}:operator:in_house`;
    if (signature === `empty:fill:system:filled|${suffix}`) return true;
    if (
      startsFromCustomer
      && signature === `${steps[0].fromStatus}:return:system:empty|empty:fill:system:filled|${suffix}`
    ) return true;
    return startsInHouse
      && signature === `in_house:inhouse_return:system:empty|empty:fill:system:filled|${suffix}`;
  }

  return false;
}

function requiredEvidenceForSteps(steps: readonly TransitionStep[]): RecoveryEvidenceKey[] {
  const required = new Set<RecoveryEvidenceKey>(["physicalTankConfirmed"]);
  if (steps.some((step) => step.actorType === "system" && step.action.includes("return"))) {
    required.add("possessionConfirmed");
  }
  if (steps.some((step) => step.actorType === "system" && step.businessEffect === "rental_close")) {
    required.add("previousCustomerConfirmed");
  }
  if (steps.some((step) => step.action === "fill")) required.add("fillStateConfirmed");
  return RECOVERY_EVIDENCE_KEYS.filter((key) => required.has(key));
}

function normalizeFingerprintInput(input: RecoveryConfirmationFingerprintInput) {
  if (!isNonEmptyString(input.tankId)) throw new Error("fingerprintのtankIdは必須です。");
  if (!isTankStatusCode(input.status)) throw new Error(`[${input.tankId}] statusが不正です。`);
  if (!isTankActionCode(input.requestedAction) || !normalizeTransitionAction(input.requestedAction)) {
    throw new Error(`[${input.tankId}] requestedActionが不正です。`);
  }
  const plan = normalizeTransitionPlan(input.plan);
  if (!plan) throw new Error(`[${input.tankId}] transitionPlanが不正です。`);
  const planValidation = validateTransitionPlan({
    plan,
    currentStatus: input.status,
    requestedAction: input.requestedAction,
  });
  if (!planValidation.ok) {
    throw new Error(`[${input.tankId}] ${planValidation.reason}`);
  }
  if (!isNonNegativeSafeInteger(input.policyRevision)) {
    throw new Error(`[${input.tankId}] policyRevisionが不正です。`);
  }
  return {
    tankId: input.tankId.trim(),
    latestLogId: normalizeOptionalFingerprintString(input.latestLogId, "latestLogId"),
    status: input.status,
    location: normalizeOptionalFingerprintString(input.location, "location"),
    customerId: normalizeOptionalFingerprintString(input.customerId, "customerId"),
    customerName: normalizeOptionalFingerprintString(input.customerName, "customerName"),
    requestedAction: input.requestedAction,
    plan,
    policyRevision: input.policyRevision,
  };
}

function toCanonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSONに有限値以外のnumberは使用できません。");
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalValue);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    Object.keys(value).sort().forEach((key) => {
      const child = value[key];
      if (child !== undefined) result[key] = toCanonicalValue(child);
    });
    return result;
  }
  throw new Error("canonical JSONで扱えない値が含まれています。");
}

function isCanonicalEvidenceOrder(keys: readonly RecoveryEvidenceKey[]): boolean {
  const normalized = RECOVERY_EVIDENCE_KEYS.filter((key) => keys.includes(key));
  return normalized.length === keys.length
    && normalized.every((key, index) => key === keys[index]);
}

function isRecoveryEvidenceKey(value: unknown): value is RecoveryEvidenceKey {
  return RECOVERY_EVIDENCE_KEYS.includes(value as RecoveryEvidenceKey);
}

function currentCustomer(state: TransitionPlannerState): TransitionCustomerSnapshot | null {
  return normalizeCustomer({
    customerId: state.customerId ?? "",
    customerName: state.customerName ?? "",
  });
}

function normalizeCustomer(
  customer: TransitionCustomerSnapshot | null | undefined,
): TransitionCustomerSnapshot | null {
  if (!customer || !isNonEmptyString(customer.customerId) || !isNonEmptyString(customer.customerName)) {
    return null;
  }
  return {
    customerId: customer.customerId.trim(),
    customerName: customer.customerName.trim(),
  };
}

function targetLocation(request: TransitionPlanRequest, fallback: string): string {
  return isNonEmptyString(request.targetLocation) ? request.targetLocation.trim() : fallback;
}

function normalizeOptionalFingerprintString(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`fingerprintの${label}が不正です。`);
  const normalized = value.trim();
  return normalized || null;
}

function noRecipe(
  request: TransitionPlanRequest,
  action: TankOperationActionCode,
): Extract<TransitionPlanResult, { ok: false }> {
  return blocked(
    "no_recovery_recipe",
    `「${request.current.status}」から「${action}」への承認済み自動補完レシピはありません。`,
  );
}

function blocked(
  code: TransitionPlanBlockCode,
  reason: string,
): Extract<TransitionPlanResult, { ok: false }> {
  return { ok: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalOptionalString(value: unknown): value is string | undefined {
  return value === undefined
    || (typeof value === "string" && value.length > 0 && value === value.trim());
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
