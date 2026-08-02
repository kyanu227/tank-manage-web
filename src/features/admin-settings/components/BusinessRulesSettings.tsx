"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { canManageAdminSetting } from "@/lib/admin/adminSettingsPresentation";
import {
  getInspectionSettings,
  getPortalSettings,
  saveInspectionSettings,
  savePortalSettings,
} from "@/lib/firebase/admin-settings";
import {
  DEFAULT_INSPECTION_SETTINGS,
  INSPECTION_SETTINGS_LIMITS,
  validateInspectionSettings,
} from "@/lib/inspection-settings";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b",
};

export default function BusinessRulesSettings() {
  const { can, role } = useAdminCapabilities();
  const canManage = canManageAdminSetting(role, can("settings.businessRules.manage"));
  const [loading, setLoading] = useState(true);
  const [portalLoaded, setPortalLoaded] = useState(false);
  const [inspectionLoaded, setInspectionLoaded] = useState(false);
  const [portalSaving, setPortalSaving] = useState(false);
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [autoReturnHour, setAutoReturnHour] = useState(17);
  const [autoReturnMinute, setAutoReturnMinute] = useState(0);
  const [validityYears, setValidityYears] = useState(DEFAULT_INSPECTION_SETTINGS.validityYears);
  const [alertMonths, setAlertMonths] = useState(DEFAULT_INSPECTION_SETTINGS.alertMonths);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const [portalResult, inspectionResult] = await Promise.allSettled([
      getPortalSettings(),
      getInspectionSettings(),
    ]);

    if (portalResult.status === "fulfilled") {
      setAutoReturnHour(portalResult.value.autoReturnHour);
      setAutoReturnMinute(portalResult.value.autoReturnMinute);
      setPortalLoaded(true);
      setPortalError(null);
    } else {
      console.error("Fetch portal settings error:", portalResult.reason);
      setPortalLoaded(false);
      setPortalError("ポータル設定を読み込めませんでした。");
    }

    if (inspectionResult.status === "fulfilled") {
      setValidityYears(inspectionResult.value.validityYears);
      setAlertMonths(inspectionResult.value.alertMonths);
      setInspectionLoaded(true);
      setInspectionError(null);
    } else {
      console.error("Fetch inspection settings error:", inspectionResult.reason);
      setInspectionLoaded(false);
      setInspectionError("耐圧検査設定を読み込めませんでした。");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

  const savePortal = async () => {
    if (!canManage || !portalLoaded) return;
    if (!window.confirm(`自動返却時刻を ${formatTime(autoReturnHour, autoReturnMinute)} に設定しますか？`)) return;
    setPortalSaving(true);
    setMessage(null);
    try {
      await savePortalSettings({ autoReturnHour, autoReturnMinute });
      setMessage({ kind: "success", text: "ポータル設定を保存しました。" });
    } catch (error) {
      console.error(error);
      setMessage({ kind: "error", text: "ポータル設定の保存に失敗しました。" });
    } finally {
      setPortalSaving(false);
    }
  };

  const saveInspection = async () => {
    if (!canManage || !inspectionLoaded) return;
    const errors = validateInspectionSettings({ validityYears, alertMonths });
    if (errors.length > 0) {
      setMessage({ kind: "error", text: errors.join(" ") });
      return;
    }
    if (!window.confirm(`耐圧検査設定を「有効期間 ${validityYears}年 / 告知 ${alertMonths}ヶ月前」に保存しますか？`)) return;
    setInspectionSaving(true);
    setMessage(null);
    try {
      await saveInspectionSettings({ validityYears, alertMonths });
      setMessage({ kind: "success", text: "耐圧検査設定を保存しました。" });
    } catch (error) {
      console.error(error);
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "耐圧検査設定の保存に失敗しました。" });
    } finally {
      setInspectionSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}><RefreshCw size={22} /> 読み込み中…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!canManage && (
        <div role="status" style={noticeStyle("readonly")}>
          この画面は参照専用です。設定の変更は管理者だけが実行できます。
        </div>
      )}
      {(portalError || inspectionError) && (
        <div role="alert" style={noticeStyle("error")}>
          {portalError && <div>{portalError}</div>}
          {inspectionError && <div>{inspectionError}</div>}
          <button type="button" onClick={() => void fetchSettings()} style={secondaryButtonStyle}>
            <RefreshCw size={14} /> 再読み込み
          </button>
        </div>
      )}
      {message && <div role="status" style={noticeStyle(message.kind)}>{message.text}</div>}

      <section style={cardStyle}>
        <div style={sectionHeadingStyle}>
          <Clock size={17} color="#4f46e5" />
          <div><h2 style={headingStyle}>ポータル自動返却</h2><p style={descriptionStyle}>顧客ポータルで返却申請を自動送信する基準時刻です。</p></div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <NumberField label="時" min={0} max={23} value={autoReturnHour} disabled={!canManage || !portalLoaded} onChange={setAutoReturnHour} />
          <strong style={{ paddingBottom: 11, fontSize: 22 }}>:</strong>
          <NumberField label="分" min={0} max={59} step={5} value={autoReturnMinute} disabled={!canManage || !portalLoaded} onChange={setAutoReturnMinute} />
          <span style={{ paddingBottom: 12, color: "#64748b", fontSize: 13 }}>現在: {formatTime(autoReturnHour, autoReturnMinute)}</span>
        </div>
        {canManage && <button type="button" disabled={!portalLoaded || portalSaving} onClick={() => void savePortal()} style={{ ...primaryButtonStyle, ...disabledActionStyle(!portalLoaded || portalSaving) }}><Save size={15} />{portalSaving ? "保存中…" : "自動返却時刻を保存"}</button>}
      </section>

      <section style={cardStyle}>
        <div style={sectionHeadingStyle}>
          <ShieldCheck size={17} color="#7c3aed" />
          <div><h2 style={headingStyle}>耐圧検査</h2><p style={descriptionStyle}>耐圧検査の唯一の設定元として期限と告知開始を管理します。</p></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <NumberField label="検査有効期間（年）" min={INSPECTION_SETTINGS_LIMITS.validityYears.min} max={INSPECTION_SETTINGS_LIMITS.validityYears.max} value={validityYears} disabled={!canManage || !inspectionLoaded} onChange={setValidityYears} />
          <NumberField label="告知開始（ヶ月前）" min={INSPECTION_SETTINGS_LIMITS.alertMonths.min} max={INSPECTION_SETTINGS_LIMITS.alertMonths.max} value={alertMonths} disabled={!canManage || !inspectionLoaded} onChange={setAlertMonths} />
        </div>
        {canManage && <button type="button" disabled={!inspectionLoaded || inspectionSaving} onClick={() => void saveInspection()} style={{ ...primaryButtonStyle, ...disabledActionStyle(!inspectionLoaded || inspectionSaving) }}><Save size={15} />{inspectionSaving ? "保存中…" : "耐圧検査設定を保存"}</button>}
      </section>
    </div>
  );
}

function NumberField({ label, value, min, max, step = 1, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; disabled: boolean; onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
      {label}
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} style={{ ...inputStyle, width: 150, fontSize: 18, fontWeight: 800, opacity: disabled ? 0.72 : 1 }} />
    </label>
  );
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function noticeStyle(kind: "readonly" | "success" | "error"): React.CSSProperties {
  const palette = kind === "error"
    ? { background: "#fef2f2", border: "#fecaca", color: "#991b1b" }
    : kind === "success"
      ? { background: "#ecfdf5", border: "#a7f3d0", color: "#065f46" }
      : { background: "#f8fafc", border: "#cbd5e1", color: "#475569" };
  return { background: palette.background, border: `1px solid ${palette.border}`, borderRadius: 12, color: palette.color, fontSize: 13, lineHeight: 1.7, padding: 14 };
}

function disabledActionStyle(disabled: boolean): React.CSSProperties {
  return disabled ? { cursor: "not-allowed", opacity: 0.58 } : {};
}

const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 18 };
const sectionHeadingStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10 };
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 15, color: "#0f172a" };
const descriptionStyle: React.CSSProperties = { margin: "5px 0 0", fontSize: 12, lineHeight: 1.7, color: "#64748b" };
const primaryButtonStyle: React.CSSProperties = { alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 10, background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 800, padding: "10px 16px" };
const secondaryButtonStyle: React.CSSProperties = { marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid currentColor", borderRadius: 8, background: "#fff", color: "inherit", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 10px" };
