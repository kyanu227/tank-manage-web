"use client";

import { useEffect, useState } from "react";
import { subscribeTankOperationPolicy } from "@/lib/firebase/tank-operation-policy-service";
import {
  DEFAULT_TANK_OPERATION_POLICY,
  resolveRuntimeTransitionEnforcement,
  type TankOperationPolicy,
  type TransitionEnforcementMode,
} from "@/lib/tank-transition-policy";

export type UseTankOperationPolicyResult = {
  policy: TankOperationPolicy;
  /** build rollout gateと保存済み設定を合成した、画面・planner用の実効mode。 */
  runtimeTransitionEnforcement: TransitionEnforcementMode;
  loading: boolean;
  error: Error | null;
};

/** 購読失敗時の画面表示はstrictへ倒す。書込み時の最終判断はtransaction内readを使う。 */
export function useTankOperationPolicy(): UseTankOperationPolicyResult {
  const [policy, setPolicy] = useState<TankOperationPolicy>({
    ...DEFAULT_TANK_OPERATION_POLICY,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => subscribeTankOperationPolicy(
    (nextPolicy) => {
      setPolicy(nextPolicy);
      setError(null);
      setLoading(false);
    },
    (subscriptionError) => {
      setPolicy({ ...DEFAULT_TANK_OPERATION_POLICY });
      setError(subscriptionError);
      setLoading(false);
    },
  ), []);

  return {
    policy,
    runtimeTransitionEnforcement: resolveRuntimeTransitionEnforcement(
      policy.transitionEnforcement,
    ),
    loading,
    error,
  };
}
