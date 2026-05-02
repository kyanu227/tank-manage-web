"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Save, RefreshCw, Check } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ADMIN_PAGES } from "@/lib/admin/adminPagesRegistry";

const PERMISSION_CONTROLLED_ADMIN_PAGES = ADMIN_PAGES.filter(
  (page) => !page.adminOnly && !page.devOnly && !page.hidden
);

const ROLES = ["管理者", "準管理者"] as const;

type PermMap = Record<string, string[]>;

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "settings", "adminPermissions"));
      if (snap.exists()) {
        setPermissions(snap.data().pages as PermMap);
      } else {
        // Initialize with defaults: 管理者 gets everything, 準管理者 gets dashboard only
        const defaults: PermMap = {};
        PERMISSION_CONTROLLED_ADMIN_PAGES.forEach((p) => {
          defaults[p.path] = ["管理者"];
        });
        // Default: give 準管理者 access to dashboard
        defaults["/admin"] = ["管理者", "準管理者"];
        setPermissions(defaults);
      }
    } catch (e) {
      console.error("Failed to fetch permissions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const toggleRole = (path: string, role: string) => {
    // 管理者 is always checked and cannot be toggled
    if (role === "管理者") return;

    setPermissions((prev) => {
      const current = prev[path] || ["管理者"];
      const has = current.includes(role);
      return {
        ...prev,
        [path]: has ? current.filter((r) => r !== role) : [...current, role],
      };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!confirm("権限設定を保存しますか？")) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "adminPermissions"), {
        pages: permissions,
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            ページ権限設定
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
            準管理者がアクセスできる管理ページを設定します
          </p>
        </div>
        <button
          onClick={fetchPermissions}
          disabled={loading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", background: "#fff",
            color: "#64748b", fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
          再読込
        </button>
      </div>

      {/* Info banner */}
      <div style={{
        background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 12,
        padding: "14px 18px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <Shield size={20} color="#6366f1" style={{ flexShrink: 0 }} />
        <p style={{ fontSize: 13, color: "#4338ca", fontWeight: 500, lineHeight: 1.5 }}>
          「管理者」は常に全ページにアクセスできます（変更不可）。<br />
          ここでは「準管理者」のアクセス権限のみ設定できます。
        </p>
      </div>

      {/* Table */}
      <div style={{
        background: "#fff", border: "1px solid #e8eaed", borderRadius: 16,
        overflow: "hidden",
      }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
            <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 600 }}>読み込み中…</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                <th style={{
                  padding: "14px 20px", fontSize: 12, fontWeight: 700,
                  color: "#94a3b8", textAlign: "left", textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}>
                  ページ
                </th>
                {ROLES.map((role) => (
                  <th key={role} style={{
                    padding: "14px 20px", fontSize: 12, fontWeight: 700,
                    color: "#94a3b8", textAlign: "center", textTransform: "uppercase",
                    letterSpacing: "0.05em", width: 120,
                  }}>
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_CONTROLLED_ADMIN_PAGES.map((page) => {
                const roles = permissions[page.path] || ["管理者"];
                return (
                  <tr key={page.path} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>
                        {page.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>
                        {page.path}
                      </div>
                    </td>
                    {ROLES.map((role) => {
                      const checked = role === "管理者" || roles.includes(role);
                      const disabled = role === "管理者"; // 管理者 is always on
                      return (
                        <td key={role} style={{ padding: "14px 20px", textAlign: "center" }}>
                          <button
                            onClick={() => toggleRole(page.path, role)}
                            disabled={disabled}
                            style={{
                              width: 36, height: 36, borderRadius: 10,
                              border: checked
                                ? "2px solid #6366f1"
                                : "2px solid #e2e8f0",
                              background: checked ? "#eef2ff" : "#fff",
                              color: checked ? "#6366f1" : "#cbd5e1",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.5 : 1,
                              transition: "all 0.15s",
                            }}
                          >
                            {checked && <Check size={18} strokeWidth={3} />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Save button */}
      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 24px", borderRadius: 12, border: "none",
            background: saved ? "#10b981" : "#6366f1",
            color: "#fff", fontSize: 15, fontWeight: 800,
            cursor: (saving || loading) ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {saved ? (
            <><Check size={18} /> 保存しました</>
          ) : saving ? (
            <><RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> 保存中…</>
          ) : (
            <><Save size={18} /> 権限設定を保存</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
