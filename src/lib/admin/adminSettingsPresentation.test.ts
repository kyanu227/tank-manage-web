import { describe, expect, it } from "vitest";
import {
  buildTransitionModeChangeSummary,
  canManageAdminSetting,
  getOperationModeSaveErrorMessage,
  isNonDefaultTransitionMode,
  shouldShowStateDiagramLink,
} from "@/lib/admin/adminSettingsPresentation";

describe("operation mode confirmation presentation", () => {
  it("shows before, after and impact for the custom confirmation dialog", () => {
    expect(buildTransitionModeChangeSummary("strict", "advisory")).toEqual({
      from: "strict",
      to: "advisory",
      fromLabel: "厳格モード",
      toLabel: "自動補完モード",
      impact: "通常運用の不一致を確認付きの正規経路へ展開し、管理者レビューまで正式集計から除外します。",
    });
  });

  it("keeps every settings write admin-only even if a subadmin receives a manage capability", () => {
    expect(canManageAdminSetting("管理者", true)).toBe(true);
    expect(canManageAdminSetting("管理者", false)).toBe(false);
    expect(canManageAdminSetting("準管理者", true)).toBe(false);
  });

  it("keeps failed saves visibly failed", () => {
    expect(getOperationModeSaveErrorMessage(new Error("revision conflict"))).toEqual({
      kind: "error",
      text: "revision conflict",
    });
    expect(getOperationModeSaveErrorMessage("unknown").kind).toBe("error");
  });

  it("warns for non-default mode and capability-gates the diagram link", () => {
    expect(isNonDefaultTransitionMode("strict")).toBe(false);
    expect(isNonDefaultTransitionMode("advisory")).toBe(true);
    expect(shouldShowStateDiagramLink(false)).toBe(false);
    expect(shouldShowStateDiagramLink(true)).toBe(true);
  });
});
