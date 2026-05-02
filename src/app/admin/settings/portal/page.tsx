"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, RefreshCw, Save } from "lucide-react";
import { getPortalSettings, savePortalSettings } from "@/lib/firebase/admin-settings";

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

export default function PortalSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [portalSaving, setPortalSaving] = useState(false);
  const [autoReturnHour, setAutoReturnHour] = useState<number>(17);
  const [autoReturnMinute, setAutoReturnMinute] = useState<number>(0);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await getPortalSettings();
      setAutoReturnHour(settings.autoReturnHour);
      setAutoReturnMinute(settings.autoReturnMinute);
    } catch (e) {
      console.error("Fetch portal settings error:", e);
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
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>ポータル設定</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>顧客ポータルの自動返却時刻などを管理します。</p>
      </div>

      {/* Auto return time */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Clock size={16} color="#6366f1" />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: 0 }}>自動返却実行時刻</h3>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
          毎日この時刻以降に顧客がポータルの返却画面を開くと、自動的に返却申請が送信されます。
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>時</label>
            <input
              type="number"
              min={0} max={23}
              value={autoReturnHour}
              onChange={(e) => setAutoReturnHour(Math.min(23, Math.max(0, Number(e.target.value))))}
              style={{ ...inputStyle, width: 80, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
            />
          </div>
          <span style={{ fontSize: 28, fontWeight: 900, color: "#334155", paddingTop: 20 }}>:</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>分</label>
            <input
              type="number"
              min={0} max={59} step={5}
              value={autoReturnMinute}
              onChange={(e) => setAutoReturnMinute(Math.min(59, Math.max(0, Number(e.target.value))))}
              style={{ ...inputStyle, width: 80, textAlign: "center", fontSize: 24, fontWeight: 800, fontFamily: "monospace", padding: "10px 8px" }}
            />
          </div>
          <div style={{ paddingTop: 22, color: "#64748b", fontSize: 14, fontWeight: 600 }}>
            現在: {String(autoReturnHour).padStart(2, "0")}:{String(autoReturnMinute).padStart(2, "0")}
          </div>
        </div>
      </div>

      <button
        disabled={portalSaving}
        onClick={async () => {
          if (!confirm(`自動返却時刻を ${String(autoReturnHour).padStart(2,"0")}:${String(autoReturnMinute).padStart(2,"0")} に設定しますか？`)) return;
          setPortalSaving(true);
          try {
            await savePortalSettings({ autoReturnHour, autoReturnMinute });
            alert("保存しました");
          } catch (e) {
            console.error(e);
            alert("保存に失敗しました");
          } finally {
            setPortalSaving(false);
          }
        }}
        style={btnPrimary}
      >
        <Save size={16} />
        {portalSaving ? "保存中…" : "ポータル設定を保存"}
      </button>
    </div>
  );
}
