import {
  validateRecoveryEvidence,
  type RecoveryEvidence,
  type TransitionPlan,
} from "./tank-transition-policy";

export type RecoveryConfirmationValidationInput = {
  tankId: string;
  plan: TransitionPlan;
  expectedFingerprint: string;
  confirmation?: {
    fingerprint: string;
    recoveryReason: string;
    recoveryEvidence: RecoveryEvidence;
  };
};

/**
 * UI確認後のpayloadをtransaction内の再計画結果と比較する。
 * 全件未確認の場合だけfalseを返し、UI確認要求へ進める。
 * 一部欠落・fingerprint不一致・証跡不足は再確認せずhard abortする。
 */
export function assertRecoveryConfirmationsMatchReplannedState(
  inputs: readonly RecoveryConfirmationValidationInput[],
): boolean {
  if (inputs.length === 0) return false;
  const confirmations = inputs.map((input) => input.confirmation);
  if (confirmations.every((confirmation) => confirmation === undefined)) return false;

  if (confirmations.some((confirmation) => confirmation === undefined)) {
    throw new Error("一括自動補完の確認情報が一部のタンクにありません。全件を中止しました。");
  }

  const fingerprintMismatch = inputs.some(({ expectedFingerprint, confirmation }) => (
    !isSha256Hex(expectedFingerprint)
    || !isSha256Hex(confirmation!.fingerprint)
    || confirmation!.fingerprint !== expectedFingerprint
  ));
  if (fingerprintMismatch) {
    throw new Error(
      "確認後にタンク状態、貸出先、場所、最新ログ、policyまたは遷移計画が変更されたため、一括操作を中止しました。内容を再読み込みしてください。",
    );
  }

  const invalidEvidence = inputs.find(({ plan, confirmation }) => (
    confirmation!.recoveryReason.trim().length < 5
    || !validateRecoveryEvidence(plan, confirmation!.recoveryEvidence).ok
  ));
  if (invalidEvidence) {
    throw new Error(
      `[${invalidEvidence.tankId}] plannerが要求した確認項目または理由を検証できないため、一括操作を中止しました。`,
    );
  }

  return true;
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
