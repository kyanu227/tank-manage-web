"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Plus, Trash2, Save, Loader2, Mail, MessageSquare } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { isNewDocId } from "@/lib/firebase/diff-write";
import { saveAdminNotificationSettings } from "@/lib/firebase/admin-notification-settings";

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
  const [emails, setEmails] = useState<string[]>([]);
  const [lineConfigs, setLineConfigs] = useState<LineConfig[]>([]);
  const [alertMonths, setAlertMonths] = useState(6);
  const [validityYears, setValidityYears] = useState(3);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirtyLineConfigIds, setDirtyLineConfigIds] = useState<string[]>([]);
  const [deletedLineConfigIds, setDeletedLineConfigIds] = useState<string[]>([]);

  const fetchSettings = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "notifySettings"));
      snap.forEach((d) => {
        const data = d.data();
        if (d.id === "config") {
          setEmails(data.emails || []);
          setAlertMonths(data.alertMonths || 6);
          setValidityYears(data.validityYears || 3);
        }
      });
      const lineSnap = await getDocs(collection(db, "lineConfigs"));
      const configs: LineConfig[] = [];
      lineSnap.forEach((d) => configs.push({ uid: d.id, ...d.data() } as LineConfig));
      setLineConfigs(configs);
      setDirtyLineConfigIds([]);
      setDeletedLineConfigIds([]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const addEmail = () => setEmails((prev) => [...prev, ""]);
  const updateEmail = (i: number, val: string) => setEmails((prev) => prev.map((e, idx) => idx === i ? val : e));
  const removeEmail = (i: number) => setEmails((prev) => prev.filter((_, idx) => idx !== i));

  const addLine = () => setLineConfigs((prev) => [...prev, { uid: `new_${Date.now()}`, name: "", token: "", groupId: "", targets: ["ALL"] }]);
  const updateLine = (uid: string, field: keyof Omit<LineConfig, "uid" | "targets">, val: string) => {
    setDirtyLineConfigIds((prev) => prev.includes(uid) ? prev : [...prev, uid]);
    setLineConfigs((prev) => prev.map((c) => c.uid === uid ? { ...c, [field]: val } : c));
  };
  const removeLine = (uid: string) => {
    if (!isNewDocId(uid)) {
      setDeletedLineConfigIds((prev) => prev.includes(uid) ? prev : [...prev, uid]);
    }
    setDirtyLineConfigIds((prev) => prev.filter((id) => id !== uid));
    setLineConfigs((prev) => prev.filter((c) => c.uid !== uid));
  };
  const toggleTarget = (uid: string, target: string) => {
    setDirtyLineConfigIds((prev) => prev.includes(uid) ? prev : [...prev, uid]);
    setLineConfigs((prev) => prev.map((c) => {
      if (c.uid !== uid) return c;
      const has = c.targets.includes(target);
      return { ...c, targets: has ? c.targets.filter((t) => t !== target) : [...c.targets, target] };
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveAdminNotificationSettings({
        emails,
        alertMonths,
        validityYears,
        lineConfigs,
        dirtyLineConfigIds,
        deletedLineConfigIds,
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

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>通知設定</h1>
      <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>LINE・Email通知と耐圧検査アラートの設定</p>

      {/* System Settings */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Bell size={16} color="#6366f1" /> システム設定
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>アラート月数</label>
            <input type="number" value={alertMonths} onChange={(e) => setAlertMonths(Number(e.target.value))} style={inputStyle} />
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>耐圧検査期限の何ヶ月前に通知するか</p>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>有効年数</label>
            <input type="number" value={validityYears} onChange={(e) => setValidityYears(Number(e.target.value))} style={inputStyle} />
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>耐圧検査の有効期間（年）</p>
          </div>
        </div>
      </div>

      {/* Email */}
      <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 8 }}>
            <Mail size={16} color="#0ea5e9" /> メール通知先
          </h2>
          <button onClick={addEmail} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> 追加
          </button>
        </div>
        {emails.length === 0 ? (
          <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 12 }}>メールアドレスが未登録です</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {emails.map((email, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input value={email} onChange={(e) => updateEmail(i, e.target.value)} placeholder="email@example.com" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }} />
                <button onClick={() => removeEmail(i)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}><Trash2 size={16} /></button>
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
          <button onClick={addLine} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> 追加
          </button>
        </div>
        {lineConfigs.length === 0 ? (
          <p style={{ fontSize: 13, color: "#cbd5e1", textAlign: "center", padding: 12 }}>LINE設定が未登録です</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {lineConfigs.map((c) => (
              <div key={c.uid} style={{ padding: 16, borderRadius: 12, background: "#f8fafc", border: "1px solid #e8eaed" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <input value={c.name} onChange={(e) => updateLine(c.uid, "name", e.target.value)} placeholder="設定名（例: 社内通知）" style={{ ...inputStyle, fontWeight: 700, border: "none", background: "transparent", padding: 0, fontSize: 14 }} />
                  <button onClick={() => removeLine(c.uid)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}><Trash2 size={16} /></button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={c.token} onChange={(e) => updateLine(c.uid, "token", e.target.value)} placeholder="Channel Access Token" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }} />
                  <input value={c.groupId} onChange={(e) => updateLine(c.uid, "groupId", e.target.value)} placeholder="Group ID（空=Broadcast）" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }} />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {TARGET_OPTIONS.map((opt) => (
                      <button key={opt.value} onClick={() => toggleTarget(c.uid, opt.value)}
                        style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "1px solid", cursor: "pointer",
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
      <button onClick={handleSave} disabled={saving}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 12, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
        {saving ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
        {saving ? "保存中…" : "通知設定を保存"}
      </button>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
