"use client";

import { useMemo } from "react";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import { StaffOperationError } from "@/lib/staff-operation-error";
import { buildTankRecoveryConfirmationMessage } from "@/lib/tank-recovery-confirmation-message";
import type {
  TankRecoveryConfirmationResolver,
} from "@/lib/tank-operation";
import type { RecoveryEvidence } from "@/lib/tank-transition-policy";

export function useTankRecoveryConfirmationResolver(): TankRecoveryConfirmationResolver {
  const locale = useStaffLocale();
  return useMemo(
    () => createTankRecoveryConfirmationResolver(locale),
    [locale],
  );
}

/** 現行UXどおり、対象タンクを入力順に1本ずつ native dialog で確認する。 */
export function createTankRecoveryConfirmationResolver(
  locale: Locale,
): TankRecoveryConfirmationResolver {
  return async ({ fingerprint, requirements }) => {
    if (typeof window === "undefined") {
      throw new StaffOperationError("recovery_browser_required");
    }

    for (const [index, requirement] of requirements.entries()) {
      const accepted = window.confirm(buildTankRecoveryConfirmationMessage(
        requirement,
        index,
        requirements.length,
        locale,
      ));
      if (!accepted) {
        throw new StaffOperationError("recovery_cancelled");
      }
    }

    const recoveryEvidence: RecoveryEvidence = {};
    requirements.forEach((requirement) => {
      requirement.plan.requiredEvidence.forEach((key) => {
        recoveryEvidence[key] = true;
      });
    });

    return {
      fingerprint,
      recoveryEvidence,
    };
  };
}
