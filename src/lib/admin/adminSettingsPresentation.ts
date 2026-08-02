import type { TransitionEnforcementMode } from "@/lib/tank-transition-policy";

export function canManageAdminSetting(role: string, manageCapabilityGranted: boolean): boolean {
  return role === "管理者" && manageCapabilityGranted;
}

export function isNonDefaultTransitionMode(mode: TransitionEnforcementMode): boolean {
  return mode !== "strict";
}

export function shouldShowStateDiagramLink(viewCapabilityGranted: boolean): boolean {
  return viewCapabilityGranted;
}

export function getOperationModeSaveErrorMessage(error: unknown): {
  kind: "error";
  text: string;
} {
  return {
    kind: "error",
    text: error instanceof Error ? error.message : "保存に失敗しました。",
  };
}

export const TRANSITION_MODE_PRESENTATION: Readonly<Record<TransitionEnforcementMode, {
  label: string;
  impact: string;
}>> = {
  strict: {
    label: "厳格モード",
    impact: "状態が一致しない新しい操作を停止します。既存のpendingレビューは残ります。",
  },
  advisory: {
    label: "自動補完モード",
    impact: "通常運用の不一致を確認付きの正規経路へ展開し、管理者レビューまで正式集計から除外します。",
  },
};

export function buildTransitionModeChangeSummary(
  from: TransitionEnforcementMode,
  to: TransitionEnforcementMode,
) {
  return {
    from,
    to,
    fromLabel: TRANSITION_MODE_PRESENTATION[from].label,
    toLabel: TRANSITION_MODE_PRESENTATION[to].label,
    impact: TRANSITION_MODE_PRESENTATION[to].impact,
  } as const;
}
