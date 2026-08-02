"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save, Loader2, Mail, MessageSquare, RefreshCw } from "lucide-react";
import AdminSettingsPageShell from "@/components/admin/AdminSettingsPageShell";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { canManageAdminSetting } from "@/lib/admin/adminSettingsPresentation";
import { isNewDocId } from "@/lib/firebase/diff-write";
import {
  loadAdminNotificationSettings,
  saveAdminNotificationSettings,
} from "@/lib/firebase/admin-notification-settings";

interface LineConfig {
  uid: string;
  name: string;
  token: string;
  groupId: string;
  targets: string[];
}

const TARGET_OPTIONS = [
  { value: "ALL", label: "すべて" },
  { value: "DAILY", label: "日次通知" },
  { value: "INSPECTION", label: "耐圧検査" },
];

export default function NotificationsPage() {
  return (
    <AdminSettingsPageShell activeTab="notifications">
      <NotificationsContent />
    </AdminSettingsPageShell>
  );
}

function NotificationsContent() {
  const { can, role } = useAdminCapabilities();
  const canManage = canManageAdminSetting(role, can("settings.notifications.manage"));
  const [emails, setEmails] = useState<string[]>([]);
  const [lineConfigs, setLineConfigs] = useState<LineConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirtyLineConfigIds, setDirtyLineConfigIds] = useState<string[]>([]);
  const [deletedLineConfigIds, setDeletedLineConfigIds] = useState<string[]>([]);
  const [notifySettingsLoaded, setNotifySettingsLoaded] = useState(false);
  const [lineConfigsLoaded, setLineConfigsLoaded] = useState(false);
  const [notifySettingsLoadError, setNotifySettingsLoadError] = useState<string | null>(null);
  const [lineConfigsLoadError, setLineConfigsLoadError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadAdminNotificationSettings();
      const notifyLoaded = result.notifySettings.status === "loaded";
      const lineLoaded = result.lineConfigs.status === "loaded";
      setNotifySettingsLoaded(notifyLoaded);
      setLineConfigsLoaded(lineLoaded);

      if (result.notifySettings.status === "loaded") {
        const settings = result.notifySettings.value.settings;
        setEmails(settings.emails);
        setNotifySettingsLoadError(null);
      } else {
        console.error("Failed to load notification settings", result.notifySettings.error);
        setNotifySettingsLoadError("メール通知設定を読み込めませんでした。");
      }

      if (result.lineConfigs.status === "loaded") {
        setLineConfigs(result.lineConfigs.value);
        setDirtyLineConfigIds([]);
        setDeletedLineConfigIds([]);
        setLineConfigsLoadError(null);
      } else {
        console.error("Failed to load LINE settings", result.lineConfigs.error);
        setLineConfigsLoadError("LINE通知設定を読み込めませんでした。");
      }
    } catch (e) {
      console.error(e);
      setNotifySettingsLoaded(false);
      setLineConfigsLoaded(false);
      setNotifySettingsLoadError("メール通知設定を読み込めませんでした。");
      setLineConfigsLoadError("LINE通知設定を読み込めませんでした。");
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const addEmail = () => { if (canManage) setEmails((prev) => [...prev, ""]); };
  const updateEmail = (i: number, val: string) => { if (canManage) setEmails((prev) => prev.map((e, idx) => idx === i ? val : e)); };
  const removeEmail = (i: number) => { if (canManage) setEmails((prev) => prev.filter((_, idx) => idx !== i)); };

  const addLine = () => { if (canManage) setLineConfigs((prev) => [...prev, { uid: `new_${Date.now()}`, name: "", token: "", groupId: "", targets: ["ALL"] }]); };
  const updateLine = (uid: string, field: keyof Omit<LineConfig, "uid" | "targets">, val: string) => {
    if (!canManage) return;
    setDirtyLineConfigIds((prev) => prev.includes(uid) ? prev : [...prev, uid]);
    setLineConfigs((prev) => prev.map((c) => c.uid === uid ? { ...c, [field]: val } : c));
  };
  const removeLine = (uid: string) => {
    if (!canManage) return;
    if (!isNewDocId(uid)) {
      setDeletedLineConfigIds((prev) => prev.includes(uid) ? prev : [...prev, uid]);
    }
    setDirtyLineConfigIds((prev) => prev.filter((id) => id !== uid));
    setLineConfigs((prev) => prev.filter((c) => c.uid !== uid));
  };
  const toggleTarget = (uid: string, target: string) => {
    if (!canManage) return;
    setDirtyLineConfigIds((prev) => prev.includes(uid) ? prev : [...prev, uid]);
    setLineConfigs((prev) => prev.map((c) => {
      if (c.uid !== uid) return c;
      const has = c.targets.includes(target);
      return { ...c, targets: has ? c.targets.filter((t) => t !== target) : [...c.targets, target] };
    }));
  };

  const handleSave = async () => {
    if (!canManage) return;
    if (!notifySettingsLoaded || !lineConfigsLoaded) {
      alert("未取得の設定があるため保存できません。再読み込みしてください。");
      return;
    }
    setSaving(true);
    try {
      await saveAdminNotificationSettings({
        emails,
        lineConfigs,
        dirtyLineConfigIds,
        deletedLineConfigIds,
        notifySettingsLoaded,
        lineConfigsLoaded,
      });
      await fetchSettings();
      alert("通知設定を保存しました。");
    } catch (e: unknown) {
      alert("保存エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
    border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
    background: "#fff", color: "#1e293b",
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>;

  const canSave = notifySettingsLoaded && lineConfigsLoaded;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>通知</h2>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>メール、LINE、通知対象を管理します。</p>

      {!canManage && (
        <div role="status" style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 12, padding: 14, marginBottom: 20, color: "#475569", fontSize: 13 }}>
          この画面は参照専用です。通知設定の変更は管理者だけが実行できます。
        </div>
      )}

      {(notifySettingsLoadError || lineConfigsLoadError) && (
        <div role="alert" style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: 14, marginBottom: 20, color: "#9a3412", fontSize: 13 }}>
          {notifySettingsLoadError && <div>{notifySettingsLoadError}</div>}
          {lineConfigsLoadError && <div>{lineConfigsLoadError}</div>}
          <div style={{ marginTop: 6 }}>取得できた領域は表示していますが、全領域を再取得するまで保存できません。</div>
          <button onClick={() => void fetchSettings()} style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid #fdba74", background: "#fff", color: "#9a3412", fontWeight: 700, cursor: "pointer" }}>
            <RefreshCw size={14} /> 再読み込み
          </button>
        </div>
      )}

      {/* Email */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 8 }}>
            <Mail size={16} color="#0ea5e9" /> メール通知先
          </h2>
          {canManage && <button onClick={addEmail} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> 追加
          </button>}
        </div>
        {emails.length === 0 ? (
          <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 12 }}>メールアドレスが未登録です</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {emails.map((email, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input value={email} disabled={!canManage} onChange={(e) => updateEmail(i, e.target.value)} placeholder="email@example.com" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, opacity: canManage ? 1 : 0.72 }} />
                {canManage && <button onClick={() => removeEmail(i)} aria-label={`${email || `${i + 1}件目`}を削除`} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LINE */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquare size={16} color="#10b981" /> LINE通知設定
          </h2>
          {canManage && <button onClick={addLine} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> 追加
          </button>}
        </div>
        {lineConfigs.length === 0 ? (
          <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 12 }}>LINE設定が未登録です</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {lineConfigs.map((c) => (
              <div key={c.uid} style={{ padding: 16, borderRadius: 12, background: "#f8fafc", border: "1px solid #e8eaed" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <input value={c.name} disabled={!canManage} onChange={(e) => updateLine(c.uid, "name", e.target.value)} placeholder="設定名（例: 社内通知）" style={{ ...inputStyle, fontWeight: 700, border: "none", background: "transparent", padding: 0, fontSize: 14 }} />
                  {canManage && <button onClick={() => removeLine(c.uid)} aria-label={`${c.name || "LINE設定"}を削除`} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={16} /></button>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={c.token} disabled={!canManage} onChange={(e) => updateLine(c.uid, "token", e.target.value)} placeholder="Channel Access Token" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }} />
                  <input value={c.groupId} disabled={!canManage} onChange={(e) => updateLine(c.uid, "groupId", e.target.value)} placeholder="Group ID（空=Broadcast）" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }} />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {TARGET_OPTIONS.map((opt) => (
                      <button key={opt.value} disabled={!canManage} onClick={() => toggleTarget(c.uid, opt.value)}
                        style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "1px solid", cursor: canManage ? "pointer" : "default",
                          borderColor: c.targets.includes(opt.value) ? "#6366f1" : "#e2e8f0",
                          background: c.targets.includes(opt.value) ? "#eef2ff" : "#fff",
                          color: c.targets.includes(opt.value) ? "#6366f1" : "#94a3b8",
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      {canManage && <button onClick={handleSave} disabled={saving || !canSave}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 12, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed", opacity: saving || !canSave ? 0.7 : 1 }}>
        {saving ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
        {saving ? "保存中…" : "通知設定を保存"}
      </button>}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
