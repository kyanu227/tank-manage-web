import type { Locale } from "./locale";
import { formatMessage } from "./operation-messages";
import { getStaffLocationLabel, type LocalizedText } from "./staff-display";
import { getTankActionLabel, getTankStatusLabel } from "./tank-action-status-labels";
import type { TankRecoveryRequirement } from "./tank-operation";
import type { RecoveryEvidenceKey } from "./tank-transition-policy";

export const TANK_RECOVERY_CONFIRMATION_TEXT = {
  browserRequired: {
    ja: "自動補完には画面上での現物確認が必要です。ブラウザから操作してください。",
    en: "Physical verification on screen is required for recovery. Run this operation in a browser.",
  },
  cancelled: {
    ja: "自動補完操作をキャンセルしました。",
    en: "The recovery operation was cancelled.",
  },
  missingPreviousCustomer: {
    ja: "[{tankId}] 旧貸出先customerId/customerNameを表示できないため、自動補完を確認完了にできません。",
    en: "[{tankId}] Recovery cannot be confirmed because the previous customer ID and name cannot be displayed.",
  },
  heading: {
    ja: "状態遷移の自動補完を実行します（{current}/{total}）。",
    en: "Run state-transition recovery ({current}/{total}).",
  },
  explanation: {
    ja: "画面上は指定操作として確定しますが、内部では下記の正規手順を一括記録します。",
    en: "The selected operation will be confirmed on screen, while the canonical steps below will be recorded together.",
  },
  aggregationPending: {
    ja: "外部顧客の貸出サイクルに影響するため、管理者レビュー完了まで請求・売上・スタッフ実績へ算入されません。",
    en: "Because this changes an external customer's rental cycle, it will not count toward billing, sales, or staff performance until an administrator completes the review.",
  },
  aggregationImmediate: {
    ja: "外部顧客の貸出サイクルを変更しない内部補完のため、確定後すぐに正式操作として扱われます。",
    en: "Because this internal recovery does not change an external customer's rental cycle, it will be treated as an official operation immediately after confirmation.",
  },
  instruction: {
    ja: "表示された現物・貸出先・充填状態等をすべて確認した場合だけ［OK］を押してください。",
    en: "Select OK only after verifying the physical tank, customer, fill state, and every other item shown.",
  },
  transitionSteps: { ja: "内部で記録するtransition steps:", en: "Transition steps to record internally:" },
  evidenceHeading: { ja: "plannerが要求した確認項目:", en: "Verification required by the planner:" },
  evidenceItem: { ja: "・{label} [{key}]", en: "- {label} [{key}]" },
  tankId: { ja: "タンクID/番号", en: "Tank ID/number" },
  displayAction: { ja: "表示操作", en: "Displayed operation" },
  currentStatus: { ja: "現在status", en: "Current status" },
  currentLocation: { ja: "現在location", en: "Current location" },
  currentHolder: { ja: "現在holder customer", en: "Current holder customer" },
  previousCustomer: { ja: "旧貸出先customer", en: "Previous customer" },
  newCustomer: { ja: "新貸出先customer", en: "New customer" },
  finalStatus: { ja: "最終状態", en: "Final status" },
  state: { ja: "状態", en: "Status" },
  actor: { ja: "実行者", en: "Actor" },
  customer: { ja: "顧客", en: "Customer" },
  location: { ja: "場所", en: "Location" },
  systemActor: { ja: "システム補完", en: "System recovery" },
  staffActor: { ja: "担当者操作", en: "Staff operation" },
  notApplicable: { ja: "該当なし", en: "Not applicable" },
  none: { ja: "なし", en: "None" },
  unknownName: { ja: "名称不明", en: "Unknown name" },
  unknownCustomerId: { ja: "customerId不明", en: "customerId unknown" },
  physicalTankConfirmed: {
    ja: "目の前の現物と、表示されたタンクID/番号が一致する",
    en: "The physical tank matches the displayed tank ID/number",
  },
  possessionConfirmed: {
    ja: "現物を回収済みで、表示された現在holderが実際に占有していない",
    en: "The tank has been recovered and the displayed current holder no longer has it",
  },
  previousCustomerConfirmed: {
    ja: "表示された旧貸出先が、このタンクの直前の貸出先である",
    en: "The displayed previous customer was the tank's immediately preceding customer",
  },
  fillStateConfirmed: {
    ja: "現物のガス充填状態が、表示された充填stepの実行内容と一致する",
    en: "The tank's physical fill state matches the displayed fill step",
  },
  damageStateConfirmed: {
    ja: "現物の破損・故障・不良状態を目視し、表示状態と一致する",
    en: "The visible damage or defect state matches the displayed status",
  },
} satisfies Record<string, LocalizedText>;

export function getTankRecoveryText(
  key: keyof typeof TANK_RECOVERY_CONFIRMATION_TEXT,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  return formatMessage(TANK_RECOVERY_CONFIRMATION_TEXT[key][locale], params);
}

export function buildTankRecoveryConfirmationMessage(
  requirement: TankRecoveryRequirement,
  index: number,
  total: number,
  locale: Locale,
): string {
  const aggregationNotice = requirement.transitionReviewStatus === "pending"
    ? getTankRecoveryText("aggregationPending", locale)
    : getTankRecoveryText("aggregationImmediate", locale);

  return [
    getTankRecoveryText("heading", locale, { current: index + 1, total }),
    getTankRecoveryText("explanation", locale),
    aggregationNotice,
    getTankRecoveryText("instruction", locale),
    "",
    buildRequirementDetails(requirement, locale),
  ].join("\n");
}

function buildRequirementDetails(
  requirement: TankRecoveryRequirement,
  locale: Locale,
): string {
  const finalStep = requirement.plan.steps.at(-1)!;
  const previousCustomerStep = requirement.plan.steps.find(
    (step) => step.businessEffect === "rental_close",
  );
  const newCustomerStep = [...requirement.plan.steps].reverse().find(
    (step) => step.businessEffect === "rental_open",
  );
  const stepDetails = requirement.plan.steps.flatMap((step, index) => [
    `step ${index + 1}: ${getTankActionLabel(step.action, locale)} (${step.action})`,
    `  ${getTankRecoveryText("state", locale)}: ${getTankStatusLabel(step.fromStatus, locale)} (${step.fromStatus}) → ${getTankStatusLabel(step.toStatus, locale)} (${step.toStatus})`,
    `  ${getTankRecoveryText("actor", locale)}: ${getTankRecoveryText(step.actorType === "system" ? "systemActor" : "staffActor", locale)} (${step.actorType})`,
    `  ${getTankRecoveryText("customer", locale)}: ${formatCustomer(step.customerId, step.customerName, getTankRecoveryText("notApplicable", locale), locale)}`,
    `  ${getTankRecoveryText("location", locale)}: ${formatLocation(step.location, locale)}`,
  ]);
  const evidence = requirement.plan.requiredEvidence.map(
    (key) => getTankRecoveryText("evidenceItem", locale, {
      label: getTankRecoveryText(key satisfies RecoveryEvidenceKey, locale),
      key,
    }),
  );

  return [
    `${getTankRecoveryText("tankId", locale)}: ${requirement.tankId}`,
    `${getTankRecoveryText("displayAction", locale)}: ${getTankActionLabel(requirement.requestedAction, locale)} (${requirement.requestedAction})`,
    `${getTankRecoveryText("currentStatus", locale)}: ${getTankStatusLabel(requirement.currentStatus, locale)} (${requirement.currentStatus})`,
    `${getTankRecoveryText("currentLocation", locale)}: ${formatLocation(requirement.currentLocation, locale)}`,
    `${getTankRecoveryText("currentHolder", locale)}: ${formatCustomer(requirement.currentCustomerId, requirement.currentCustomerName, getTankRecoveryText("none", locale), locale)}`,
    `${getTankRecoveryText("previousCustomer", locale)}: ${formatCustomer(previousCustomerStep?.customerId, previousCustomerStep?.customerName, getTankRecoveryText("notApplicable", locale), locale)}`,
    `${getTankRecoveryText("newCustomer", locale)}: ${formatCustomer(newCustomerStep?.customerId, newCustomerStep?.customerName, getTankRecoveryText("notApplicable", locale), locale)}`,
    `${getTankRecoveryText("finalStatus", locale)}: ${getTankStatusLabel(finalStep.toStatus, locale)} (${finalStep.toStatus})`,
    "",
    getTankRecoveryText("transitionSteps", locale),
    ...stepDetails,
    "",
    getTankRecoveryText("evidenceHeading", locale),
    ...evidence,
  ].join("\n");
}

function formatCustomer(
  customerId: string | null | undefined,
  customerName: string | null | undefined,
  emptyLabel: string,
  locale: Locale,
): string {
  const id = customerId?.trim();
  const name = customerName?.trim();
  if (id && name) return `${name} (customerId: ${id})`;
  if (id) return `${getTankRecoveryText("unknownName", locale)} (customerId: ${id})`;
  if (name) return `${name} (${getTankRecoveryText("unknownCustomerId", locale)})`;
  return emptyLabel;
}

function formatLocation(
  location: string | null | undefined,
  locale: Locale,
): string {
  return getStaffLocationLabel(location?.trim(), locale);
}
