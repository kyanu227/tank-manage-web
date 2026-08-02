"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, Save, ShieldCheck, Workflow } from "lucide-react";
import AdminSettingsPageShell from "@/components/admin/AdminSettingsPageShell";
import styles from "@/components/admin/AdminNavigation.module.css";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { useStaffIdentity } from "@/hooks/useStaffSession";
import { useTankOperationPolicy } from "@/hooks/useTankOperationPolicy";
import {
  buildTransitionModeChangeSummary,
  canManageAdminSetting,
  getOperationModeSaveErrorMessage,
  isNonDefaultTransitionMode,
  shouldShowStateDiagramLink,
  TRANSITION_MODE_PRESENTATION,
} from "@/lib/admin/adminSettingsPresentation";
import {
  ADVISORY_ACTIVATION_ENABLED,
  saveTankOperationPolicy,
} from "@/lib/firebase/tank-operation-policy-service";
import type { TransitionEnforcementMode } from "@/lib/tank-transition-policy";

const MODES: readonly TransitionEnforcementMode[] = ["strict", "advisory"];

type PendingMode = { value: TransitionEnforcementMode; baseRevision: number };
type Message = { kind: "success" | "error"; text: string };

export default function TankOperationPolicySettingsPage() {
  return (
    <AdminSettingsPageShell activeTab="operationMode">
      <TankOperationPolicySettings />
    </AdminSettingsPageShell>
  );
}

function TankOperationPolicySettings() {
  const actor = useStaffIdentity();
  const { can, role } = useAdminCapabilities();
  const { policy, runtimeTransitionEnforcement, loading, error } = useTankOperationPolicy();
  const [pendingMode, setPendingMode] = useState<PendingMode | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const saveTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const canManage = canManageAdminSetting(role, can("settings.operationMode.manage"));
  const selectedMode = pendingMode?.baseRevision === policy.policyRevision
    ? pendingMode.value
    : policy.transitionEnforcement;
  const dirty = selectedMode !== policy.transitionEnforcement;
  const advisoryLocked = !ADVISORY_ACTIVATION_ENABLED
    && policy.transitionEnforcement !== "advisory";
  const changeSummary = buildTransitionModeChangeSummary(
    policy.transitionEnforcement,
    selectedMode,
  );

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        setConfirming(false);
        window.requestAnimationFrame(() => saveTriggerRef.current?.focus());
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirming, saving]);

  const selectMode = (mode: TransitionEnforcementMode) => {
    if (!canManage || saving) return;
    setPendingMode({ value: mode, baseRevision: policy.policyRevision });
    setMessage(null);
  };

  const requestSave = () => {
    if (!canManage || !actor) {
      setMessage({ kind: "error", text: "状態遷移モードは有効な管理者だけが変更できます。" });
      return;
    }
    if (!dirty) return;
    if (selectedMode === "advisory" && advisoryLocked) {
      setMessage({ kind: "error", text: "Security Rules保護とemulator検証が完了するまで有効化できません。" });
      return;
    }
    setConfirming(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setConfirming(false);
    window.requestAnimationFrame(() => saveTriggerRef.current?.focus());
  };

  const confirmSave = async () => {
    if (!actor || actor.role !== "管理者" || !canManage || !dirty) {
      setConfirming(false);
      setMessage({ kind: "error", text: "管理者情報を確認できないため保存しませんでした。" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveTankOperationPolicy({
        transitionEnforcement: selectedMode,
        actor,
        expectedPolicyRevision: policy.policyRevision,
      });
      setPendingMode(null);
      setConfirming(false);
      setMessage({ kind: "success", text: "状態遷移モードを保存しました。" });
    } catch (saveError) {
      setMessage(getOperationModeSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ border: "2px solid #f59e0b", background: "#fffbeb", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <AlertTriangle size={21} color="#b45309" />
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "#78350f" }}>危険設定: タンク状態遷移モード</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.7, color: "#92400e" }}>
              不一致操作を停止するか、確認付きの正規経路へ展開するかを切り替えます。状態遷移ルール自体は変更しません。
            </p>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #fcd34d", borderRadius: 12, padding: 15, fontSize: 13, lineHeight: 1.8, color: "#475569" }}>
          <div>現在の保存値: <strong style={{ color: "#0f172a" }}>{TRANSITION_MODE_PRESENTATION[policy.transitionEnforcement].label}</strong></div>
          <div>現在の実行値: <strong style={{ color: "#0f172a" }}>{TRANSITION_MODE_PRESENTATION[runtimeTransitionEnforcement].label}</strong>{runtimeTransitionEnforcement !== policy.transitionEnforcement ? "（rollout gateにより厳格固定）" : ""}</div>
          <div>policy revision: <strong style={{ color: "#0f172a" }}>{policy.policyRevision}</strong></div>
        </div>

        {error && <div role="alert" style={noticeStyle("error")}><AlertTriangle size={17} />方針を取得できないため、表示と書込みは安全側の厳格モードとして扱います。</div>}
        {!canManage && <div role="status" style={noticeStyle("readonly")}><LockKeyhole size={17} />この設定は参照専用です。変更は有効な管理者だけが実行できます。</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {MODES.map((mode) => {
            const selected = selectedMode === mode;
            const locked = mode === "advisory" && advisoryLocked;
            return (
              <button
                key={mode}
                type="button"
                disabled={loading || saving || locked || !canManage}
                onClick={() => selectMode(mode)}
                style={{ padding: 17, textAlign: "left", borderRadius: 13, border: selected ? "2px solid #4f46e5" : "1px solid #dbe2ea", background: selected ? "#eef2ff" : "#fff", opacity: locked || !canManage ? 0.66 : 1, cursor: locked || !canManage ? "not-allowed" : "pointer" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0f172a" }}>
                  {mode === "strict" ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
                  {TRANSITION_MODE_PRESENTATION[mode].label}
                  {selected && <CheckCircle2 size={17} color="#4f46e5" />}
                  {locked && <LockKeyhole size={16} color="#b45309" />}
                </span>
                <span style={{ display: "block", marginTop: 9, fontSize: 12, lineHeight: 1.7, color: "#64748b" }}>{TRANSITION_MODE_PRESENTATION[mode].impact}</span>
              </button>
            );
          })}
        </div>

        {isNonDefaultTransitionMode(policy.transitionEnforcement) && (
          <div role="alert" style={noticeStyle("warning")}><AlertTriangle size={17} />保存値が標準の厳格モードではありません。実行値とrollout gateを確認してください。</div>
        )}
        {!ADVISORY_ACTIVATION_ENABLED && (
          <div role="status" style={noticeStyle("warning")}><LockKeyhole size={17} /><span>自動補完の実行はrollout gateで停止中です。保存値が自動補完でも実行時は厳格モードになります。厳格へ戻す操作は可能です。</span></div>
        )}
        {message && <div role="status" style={noticeStyle(message.kind)}>{message.text}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {canManage && (
            <button ref={saveTriggerRef} type="button" disabled={!dirty || loading || saving || !actor} onClick={requestSave} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", border: 0, borderRadius: 10, background: dirty && !saving ? "#b45309" : "#cbd5e1", color: "#fff", fontWeight: 800, cursor: dirty && !saving ? "pointer" : "not-allowed" }}>
              <Save size={16} /> {saving ? "保存中…" : "運用モードを変更"}
            </button>
          )}
          {shouldShowStateDiagramLink(can("developer.stateDiagram.view")) && <Link href="/admin/state-diagram" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#4338ca", fontSize: 13, fontWeight: 750 }}><Workflow size={16} />状態遷移図を確認</Link>}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, fontSize: 12, lineHeight: 1.8, color: "#475569" }}>
        <div>自動補完の対象: スタッフ直接の貸出・返却・充填・自社利用・自社返却に必要な返却／充填補完</div>
        <div>顧客transaction対象外: 受注・返却申請・未充填申請の処理経路</div>
        <div>対象外: 破損報告・故障／不良化・修理・耐圧検査・検査不合格・廃棄</div>
      </div>

      {confirming && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="operation-mode-confirm-title" aria-describedby="operation-mode-confirm-description">
            <h2 id="operation-mode-confirm-title" className={styles.dialogTitle}>運用モードを変更しますか？</h2>
            <div id="operation-mode-confirm-description" className={styles.dialogText}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", marginBottom: 12 }}>
                <span>変更前</span><strong>{changeSummary.fromLabel}</strong>
                <span>変更後</span><strong style={{ color: "#b45309" }}>{changeSummary.toLabel}</strong>
              </div>
              <strong>影響:</strong> {changeSummary.impact}
            </div>
            <div className={styles.dialogActions}>
              <button ref={cancelRef} type="button" className={`${styles.dialogButton} ${styles.dialogCancel}`} onClick={closeDialog} disabled={saving}>キャンセル</button>
              <button type="button" className={`${styles.dialogButton} ${styles.dialogDestructive}`} onClick={() => void confirmSave()} disabled={saving}>{saving ? "変更中…" : "理解して変更"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function noticeStyle(kind: "warning" | "readonly" | "error" | "success"): React.CSSProperties {
  const palette = kind === "warning"
    ? { background: "#fffbeb", border: "#fde68a", color: "#92400e" }
    : kind === "success"
      ? { background: "#ecfdf5", border: "#a7f3d0", color: "#065f46" }
      : kind === "readonly"
        ? { background: "#f8fafc", border: "#cbd5e1", color: "#475569" }
        : { background: "#fef2f2", border: "#fecaca", color: "#991b1b" };
  return { display: "flex", alignItems: "flex-start", gap: 9, padding: "12px 14px", borderRadius: 10, border: `1px solid ${palette.border}`, background: palette.background, color: palette.color, fontSize: 12, lineHeight: 1.65 };
}
