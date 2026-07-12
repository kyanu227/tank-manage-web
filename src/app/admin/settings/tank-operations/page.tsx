"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { useStaffIdentity } from "@/hooks/useStaffSession";
import { useTankOperationPolicy } from "@/hooks/useTankOperationPolicy";
import {
  ADVISORY_ACTIVATION_ENABLED,
  saveTankOperationPolicy,
} from "@/lib/firebase/tank-operation-policy-service";
import type { TransitionEnforcementMode } from "@/lib/tank-transition-policy";

const MODES: Array<{
  id: TransitionEnforcementMode;
  label: string;
  description: string;
}> = [
  {
    id: "strict",
    label: "厳格モード",
    description: "現在状態から直接許可された操作だけを確定します。不一致操作は停止します。",
  },
  {
    id: "advisory",
    label: "自動補完モード",
    description: "通常運用の不一致だけを、現物確認後に固定レシピの正規遷移へ展開します。",
  },
];

export default function TankOperationPolicySettingsPage() {
  const actor = useStaffIdentity();
  const { policy, loading, error } = useTankOperationPolicy();
  const [selectedMode, setSelectedMode] = useState<TransitionEnforcementMode>("strict");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedMode(policy.transitionEnforcement);
  }, [policy.transitionEnforcement, policy.policyRevision]);

  const dirty = selectedMode !== policy.transitionEnforcement;
  const advisoryLocked = !ADVISORY_ACTIVATION_ENABLED
    && policy.transitionEnforcement !== "advisory";

  const handleSave = async () => {
    if (!actor || actor.role !== "管理者") {
      setMessage("状態遷移モードは管理者だけが変更できます。");
      return;
    }
    if (!dirty) return;
    if (selectedMode === "advisory" && advisoryLocked) {
      setMessage("Security Rules保護とemulator検証が完了するまで有効化できません。");
      return;
    }

    const warning = selectedMode === "advisory"
      ? "自動補完モードへ変更しますか？\n不一致操作は現物確認・理由入力後に状態へ反映され、管理者レビューまで正式集計されません。"
      : "厳格モードへ変更しますか？\n既存のpendingレビューは残り、新しい不一致操作だけが停止されます。";
    if (!window.confirm(warning)) return;

    setSaving(true);
    setMessage(null);
    try {
      await saveTankOperationPolicy({
        transitionEnforcement: selectedMode,
        actor,
        expectedPolicyRevision: policy.policyRevision,
      });
      setMessage("状態遷移モードを保存しました。");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 820 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>タンク状態遷移モード</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.7, color: "#64748b" }}>
          状態遷移ルール自体は変更せず、不一致時に停止するか、確認付きの正規経路へ展開するかを切り替えます。
        </p>
      </div>

      {error && (
        <div role="alert" style={noticeStyle("error")}>
          <AlertTriangle size={18} />
          方針を取得できないため、画面と書込みは安全側の厳格モードとして扱います。
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {MODES.map((mode) => {
          const selected = selectedMode === mode.id;
          const locked = mode.id === "advisory" && advisoryLocked;
          return (
            <button
              key={mode.id}
              type="button"
              disabled={loading || saving || locked}
              onClick={() => setSelectedMode(mode.id)}
              style={{
                padding: 18,
                textAlign: "left",
                borderRadius: 14,
                border: selected ? "2px solid #4f46e5" : "1px solid #e2e8f0",
                background: selected ? "#eef2ff" : "#fff",
                opacity: locked ? 0.62 : 1,
                cursor: locked ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0f172a" }}>
                {mode.id === "strict" ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
                {mode.label}
                {selected && <CheckCircle2 size={17} color="#4f46e5" />}
                {locked && <LockKeyhole size={16} color="#b45309" />}
              </span>
              <span style={{ display: "block", marginTop: 10, fontSize: 12, lineHeight: 1.7, color: "#64748b" }}>
                {mode.description}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
        <div style={{ fontSize: 12, lineHeight: 1.8, color: "#475569" }}>
          <div>現在: <strong>{policy.transitionEnforcement === "strict" ? "厳格" : "自動補完"}</strong></div>
          <div>policy revision: <strong>{policy.policyRevision}</strong></div>
          <div>自動補完の対象: 貸出・受注貸出・返却・充填・自社利用・自社返却に必要な返却／充填補完</div>
          <div>対象外: 破損報告・故障／不良化・修理・耐圧検査・検査不合格・廃棄</div>
        </div>
      </div>

      {!ADVISORY_ACTIVATION_ENABLED && (
        <div role="status" style={noticeStyle("warning")}>
          <LockKeyhole size={18} />
          自動補完の有効化はrollout gateで停止中です。Rules保護と通常操作1/10/50/100件、返却連動1/10件のemulator検証後、
          build時に <code>NEXT_PUBLIC_TANK_ADVISORY_ACTIVATION_ENABLED=true</code> を設定してください。
        </div>
      )}

      {message && <div role="status" style={noticeStyle(message.includes("保存しました") ? "success" : "error")}>{message}</div>}

      <button
        type="button"
        disabled={!dirty || loading || saving || !actor || actor.role !== "管理者"}
        onClick={handleSave}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 18px",
          border: 0,
          borderRadius: 10,
          background: !dirty || saving ? "#cbd5e1" : "#4f46e5",
          color: "#fff",
          fontWeight: 800,
          cursor: !dirty || saving ? "not-allowed" : "pointer",
        }}
      >
        <Save size={16} /> {saving ? "保存中…" : "モードを保存"}
      </button>
    </div>
  );
}

function noticeStyle(kind: "warning" | "error" | "success"): React.CSSProperties {
  const palette = kind === "warning"
    ? { background: "#fffbeb", border: "#fde68a", color: "#92400e" }
    : kind === "success"
      ? { background: "#ecfdf5", border: "#a7f3d0", color: "#065f46" }
      : { background: "#fef2f2", border: "#fecaca", color: "#991b1b" };
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "12px 14px",
    borderRadius: 10,
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontSize: 12,
    lineHeight: 1.65,
  };
}
