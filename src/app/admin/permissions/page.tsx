"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Save, RefreshCw, Check } from "lucide-react";
import type { AdminCapabilityGrants } from "@/lib/admin/admin-permissions";
import {
  ADMIN_CAPABILITY_DEFINITIONS,
  type AdminCapability,
} from "@/lib/admin/adminCapabilities";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import {
  getAdminPermissions,
  saveAdminPermissions,
} from "@/lib/firebase/admin-permissions-service";
import AdminStaffTabs from "@/components/admin/AdminStaffTabs";

const ROLES = ["管理者", "準管理者"] as const;

export default function PermissionsPage() {
  return (
    <>
      <AdminStaffTabs activeTab="permissions" />
      <PermissionsContent />
    </>
  );
}

function PermissionsContent() {
  const { can, role: actorRole } = useAdminCapabilities();
  const canManage = can("staffPermissions.manage");
  const [permissions, setPermissions] = useState<AdminCapabilityGrants>({});
  const [legacySource, setLegacySource] = useState(false);
  const [ignoredLegacyPaths, setIgnoredLegacyPaths] = useState<readonly string[]>([]);
  const [malformedReason, setMalformedReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    setMalformedReason(null);
    try {
      const result = await getAdminPermissions();
      if (result.kind === "malformed") {
        setMalformedReason(result.reason);
        return;
      }
      setPermissions(result.capabilities);
      setLegacySource(result.kind === "valid" && result.source === "legacy-paths");
      setIgnoredLegacyPaths(result.kind === "valid" ? result.ignoredLegacyPaths : []);
    } catch (e) {
      console.error("Failed to fetch permissions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const toggleRole = (capability: AdminCapability, role: string) => {
    // 管理者 is always checked and cannot be toggled
    const definition = ADMIN_CAPABILITY_DEFINITIONS.find((item) => item.key === capability);
    if (role === "管理者" || !canManage || !definition?.assignableToSubAdmin) return;

    setPermissions((prev) => {
      const current = prev[capability] || ["管理者"];
      const has = current.includes(role);
      return {
        ...prev,
        [capability]: has ? current.filter((r) => r !== role) : [...current, role],
      };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!canManage) return;
    if (!confirm("権限設定を保存しますか？")) return;
    setSaving(true);
    try {
      await saveAdminPermissions({ capabilities: permissions, actorRole });
      setLegacySource(false);
      setIgnoredLegacyPaths([]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      alert("保存エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (malformedReason) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
              機能権限設定
            </h1>
            <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
              準管理者が利用できる機能単位の権限を設定します
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
        <div
          role="alert"
          style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12,
            padding: "18px", display: "flex", alignItems: "flex-start", gap: 12,
          }}
        >
          <Shield size={20} color="#dc2626" style={{ flexShrink: 0 }} />
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: "#991b1b", marginBottom: 4 }}>
              権限設定データが壊れています
            </h2>
            <p style={{ fontSize: 13, color: "#b91c1c", lineHeight: 1.6 }}>
              安全のため権限設定の表示と保存を停止しました。設定データを確認してください。
            </p>
            <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 8, fontFamily: "monospace" }}>
              {malformedReason}
            </p>
          </div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            機能権限設定
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>
            URLではなく、準管理者が利用できる機能を設定します
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

      {legacySource && (
        <div role="status" style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 16px", marginBottom: 16, color: "#92400e", fontSize: 13, lineHeight: 1.6 }}>
          旧path権限を決定的にcapabilityへ変換して表示しています。次回保存時はcapabilityだけを保存します。
          {ignoredLegacyPaths.length > 0 && ` 未登録path ${ignoredLegacyPaths.length}件は安全のため権限へ変換していません。`}
        </div>
      )}

      {/* Info banner */}
      <div style={{
        background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 12,
        padding: "14px 18px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <Shield size={20} color="#6366f1" style={{ flexShrink: 0 }} />
        <p style={{ fontSize: 13, color: "#4338ca", fontWeight: 500, lineHeight: 1.5 }}>
          「管理者」は常に全ページにアクセスできます（変更不可）。<br />
          ここでは「準管理者」のcapabilityだけを設定します。Rules上管理者限定の更新権限は固定です。
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
                  機能
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
              {ADMIN_CAPABILITY_DEFINITIONS.map((definition) => {
                const roles = permissions[definition.key] || ["管理者"];
                return (
                  <tr key={definition.key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>
                        {definition.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>
                        {definition.key} ・ {definition.group}
                      </div>
                    </td>
                    {ROLES.map((role) => {
                      const checked = role === "管理者" || roles.includes(role);
                      const disabled = role === "管理者"
                        || !canManage
                        || !definition.assignableToSubAdmin;
                      return (
                        <td key={role} style={{ padding: "14px 20px", textAlign: "center" }}>
                          <button
                            onClick={() => toggleRole(definition.key, role)}
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
          disabled={saving || loading || !canManage}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 24px", borderRadius: 12, border: "none",
            background: saved ? "#10b981" : "#6366f1",
            color: "#fff", fontSize: 15, fontWeight: 800,
            cursor: (saving || loading || !canManage) ? "not-allowed" : "pointer",
            opacity: canManage ? 1 : 0.6,
            transition: "all 0.2s",
          }}
        >
          {saved ? (
            <><Check size={18} /> 保存しました</>
          ) : saving ? (
            <><RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> 保存中…</>
          ) : (
            <><Save size={18} /> {canManage ? "権限設定を保存" : "閲覧のみ"}</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
