"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { getInspectionSettings, saveInspectionSettings } from "@/lib/firebase/admin-settings";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b", transition: "border-color 0.15s",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 20px", borderRadius: 10, border: "none",
  background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700,
  cursor: "pointer", transition: "all 0.15s",
};

export default function InspectionSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [inspValidityYears, setInspValidityYears] = useState<number>(5);
  const [inspAlertMonths, setInspAlertMonths] = useState<number>(6);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await getInspectionSettings();
      setInspValidityYears(settings.validityYears);
      setInspAlertMonths(settings.alertMonths);
    } catch (e) {
      console.error("Fetch inspection settings error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
        <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>データを読み込み中…</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>耐圧検査設定</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          耐圧検査の有効期間と告知開始タイミングを設定します。
        </p>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <ShieldCheck size={16} color="#8b5cf6" />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>検査有効期間</h3>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
          検査完了時、次回期限を「今日＋この年数」で更新します。（標準: 5年）
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="number"
            min={1} max={20}
            value={inspValidityYears}
            onChange={(e) => setInspValidityYears(Math.min(20, Math.max(1, Number(e.target.value))))}
            style={{ ...inputStyle, width: 100, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>年</span>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Clock size={16} color="#f59e0b" />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>告知開始タイミング</h3>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
          次回期限がこのヶ月数以内に迫ったタンクをスタッフ画面に表示します。（標準: 6ヶ月）
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="number"
            min={1} max={24}
            value={inspAlertMonths}
            onChange={(e) => setInspAlertMonths(Math.min(24, Math.max(1, Number(e.target.value))))}
            style={{ ...inputStyle, width: 100, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>ヶ月前から</span>
        </div>
      </div>

      <button
        disabled={inspectionSaving}
        onClick={async () => {
          if (!confirm(`耐圧検査設定を「有効期間 ${inspValidityYears}年 / 告知 ${inspAlertMonths}ヶ月前〜」に保存しますか？`)) return;
          setInspectionSaving(true);
          try {
            await saveInspectionSettings({
              validityYears: inspValidityYears,
              alertMonths: inspAlertMonths,
            });
            alert("保存しました");
          } catch (e) {
            console.error(e);
            alert("保存に失敗しました");
          } finally {
            setInspectionSaving(false);
          }
        }}
        style={btnPrimary}
      >
        <Save size={16} />
        {inspectionSaving ? "保存中…" : "耐圧検査設定を保存"}
      </button>
    </div>
  );
}
