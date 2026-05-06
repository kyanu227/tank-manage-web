"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye, EyeOff, Plus, RefreshCw, Save,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import {
  listStaffMembers,
  saveStaffMembers,
  type StaffMember,
} from "@/lib/firebase/staff-sync-service";
import StaffJoinRequestsPanel from "@/components/admin/StaffJoinRequestsPanel";
import {
  listStaffJoinRequestsReadOnly,
  type StaffJoinRequest,
} from "@/lib/firebase/staff-join-requests";
import {
  approveStaffJoinRequestForExistingStaff,
  rejectStaffJoinRequest,
} from "@/lib/firebase/staff-join-request-review-service";
import { useStaffIdentity } from "@/hooks/useStaffSession";

const ROLES = ["一般", "準管理者", "管理者"] as const;
const RANKS = ["レギュラー", "ブロンズ", "シルバー", "ゴールド", "プラチナ"] as const;
const staffJoinRequestsEnabled = process.env.NEXT_PUBLIC_ENABLE_STAFF_JOIN_REQUESTS === "true";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b", transition: "border-color 0.15s",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: "none" as const, paddingRight: 28,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 20px", borderRadius: 10, border: "none",
  background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700,
  cursor: "pointer", transition: "all 0.15s",
};

const btnOutline: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8,
  border: "1px solid #e2e8f0", background: "#fff",
  color: "#64748b", fontSize: 13, fontWeight: 600,
  cursor: "pointer", transition: "all 0.15s",
};

export default function AdminStaffPage() {
  const staffIdentity = useStaffIdentity();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [dirtyStaffIds, setDirtyStaffIds] = useState<string[]>([]);
  const [showPasscodes, setShowPasscodes] = useState<Set<string>>(new Set());
  const [joinRequests, setJoinRequests] = useState<StaffJoinRequest[]>([]);
  const [joinRequestsLoading, setJoinRequestsLoading] = useState(false);
  const [joinRequestsError, setJoinRequestsError] = useState("");
  const [joinRequestActionLoadingUid, setJoinRequestActionLoadingUid] = useState<string | null>(null);
  const [joinRequestActionError, setJoinRequestActionError] = useState("");

  const joinRequestStaffOptions = useMemo(() => (
    staffList
      .filter((staff) => staff.isActive)
      .map((staff) => ({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        rank: staff.rank,
        isActive: staff.isActive,
        authUid: staff.authUid,
      }))
  ), [staffList]);

  const joinRequestReviewer = useMemo(() => {
    if (!staffIdentity) return null;
    return {
      staffId: staffIdentity.staffId,
      staffName: staffIdentity.staffName,
    };
  }, [staffIdentity]);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const staff = await listStaffMembers();
      setStaffList(staff.length > 0 ? staff : []);
      setDirtyStaffIds([]);
    } catch (e) {
      console.error("Fetch staff error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchJoinRequests = useCallback(async () => {
    if (!staffJoinRequestsEnabled) return;
    setJoinRequestsLoading(true);
    setJoinRequestsError("");
    try {
      const requests = await listStaffJoinRequestsReadOnly();
      setJoinRequests(requests);
    } catch (e) {
      console.error("Fetch staff join requests error:", e);
      setJoinRequestsError("スタッフ利用申請を読み込めませんでした。スタッフ一覧の編集は継続できます。");
    } finally {
      setJoinRequestsLoading(false);
    }
  }, []);

  const approveJoinRequest = useCallback(async (uid: string, staffId: string) => {
    if (!staffJoinRequestsEnabled) return;
    if (!joinRequestReviewer) {
      setJoinRequestActionError("管理者セッションを取得できません。再ログインしてください。");
      return;
    }
    if (dirtyStaffIds.length > 0) {
      setJoinRequestActionError("担当者リストに未保存の変更があります。先に保存してから承認してください。");
      return;
    }
    if (!confirm("選択した既存スタッフに UID を紐付けて承認しますか？")) return;

    setJoinRequestActionLoadingUid(uid);
    setJoinRequestActionError("");
    try {
      await approveStaffJoinRequestForExistingStaff({
        uid,
        staffId,
        reviewer: joinRequestReviewer,
      });
      await fetchJoinRequests();
      await fetchStaff();
    } catch (e) {
      console.error("Approve staff join request error:", e);
      setJoinRequestActionError(e instanceof Error ? e.message : "スタッフ利用申請を承認できませんでした。");
    } finally {
      setJoinRequestActionLoadingUid(null);
    }
  }, [dirtyStaffIds.length, fetchJoinRequests, fetchStaff, joinRequestReviewer]);

  const rejectJoinRequest = useCallback(async (uid: string, rejectionReason?: string) => {
    if (!staffJoinRequestsEnabled) return;
    if (!joinRequestReviewer) {
      setJoinRequestActionError("管理者セッションを取得できません。再ログインしてください。");
      return;
    }
    if (!confirm("このスタッフ利用申請を却下しますか？")) return;

    setJoinRequestActionLoadingUid(uid);
    setJoinRequestActionError("");
    try {
      await rejectStaffJoinRequest({
        uid,
        reviewer: joinRequestReviewer,
        rejectionReason,
      });
      await fetchJoinRequests();
    } catch (e) {
      console.error("Reject staff join request error:", e);
      setJoinRequestActionError(e instanceof Error ? e.message : "スタッフ利用申請を却下できませんでした。");
    } finally {
      setJoinRequestActionLoadingUid(null);
    }
  }, [fetchJoinRequests, joinRequestReviewer]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);
  useEffect(() => { fetchJoinRequests(); }, [fetchJoinRequests]);

  const addStaff = () => {
    const id = `new_${Date.now()}`;
    setStaffList((prev) => [
      ...prev,
      {
        id,
        name: "", email: "", passcode: "",
        role: "一般", rank: "レギュラー", isActive: true,
      },
    ]);
    setDirtyStaffIds((prev) => prev.includes(id) ? prev : [...prev, id]);
  };

  const updateStaff = (id: string, field: keyof StaffMember, value: any) => {
    setDirtyStaffIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    setStaffList((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const togglePasscode = (id: string) => {
    setShowPasscodes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveStaff = async () => {
    if (!confirm("担当者リストを保存しますか？")) return;
    setSaving(true);
    try {
      await saveStaffMembers({ staffList, dirtyStaffIds });
      await fetchStaff();
      setDirtyStaffIds([]);
      alert("担当者リストを保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

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
    <div>
      {staffJoinRequestsEnabled && (
        <StaffJoinRequestsPanel
          requests={joinRequests}
          loading={joinRequestsLoading}
          error={joinRequestsError}
          staffOptions={joinRequestStaffOptions}
          reviewer={joinRequestReviewer}
          actionLoadingUid={joinRequestActionLoadingUid}
          actionError={joinRequestActionError}
          onRefresh={fetchJoinRequests}
          onApproveExistingStaff={approveJoinRequest}
          onReject={rejectJoinRequest}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
          ※「停止」にするとログイン不可になります
        </p>
        <button onClick={addStaff} style={btnOutline}>
          <Plus size={14} /> 追加
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e8eaed" }}>
              {["名前", "Email", "パスコード", "権限", "ランク", "状態"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staffList.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                  データがありません。「追加」ボタンで登録してください。
                </td>
              </tr>
            ) : (
              staffList.map((s) => (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    opacity: s.isActive ? 1 : 0.5,
                    background: s.isActive ? undefined : "#fafafa",
                    transition: "opacity 0.15s",
                  }}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <input
                      style={{ ...inputStyle, fontWeight: 700 }}
                      value={s.name}
                      placeholder="名前"
                      disabled={!s.isActive}
                      onChange={(e) => updateStaff(s.id, "name", e.target.value)}
                    />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <input
                      style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                      value={s.email}
                      placeholder="email@example.com"
                      disabled={!s.isActive}
                      onChange={(e) => updateStaff(s.id, "email", e.target.value)}
                    />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        type={showPasscodes.has(s.id) ? "text" : "password"}
                        style={{ ...inputStyle, fontFamily: "monospace", flex: 1 }}
                        value={s.passcode}
                        placeholder="Pass"
                        maxLength={6}
                        disabled={!s.isActive}
                        onChange={(e) => updateStaff(s.id, "passcode", e.target.value)}
                      />
                      <button
                        onClick={() => togglePasscode(s.id)}
                        style={{
                          border: "1px solid #e2e8f0", borderRadius: 8,
                          background: "#fff", padding: "0 8px",
                          cursor: "pointer", color: "#94a3b8",
                          display: "flex", alignItems: "center",
                        }}
                      >
                        {showPasscodes.has(s.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select
                      style={selectStyle}
                      value={s.role}
                      disabled={!s.isActive}
                      onChange={(e) => updateStaff(s.id, "role", e.target.value)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select
                      style={selectStyle}
                      value={s.rank}
                      disabled={!s.isActive}
                      onChange={(e) => updateStaff(s.id, "rank", e.target.value)}
                    >
                      {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    <button
                      onClick={() => updateStaff(s.id, "isActive", !s.isActive)}
                      style={{
                        border: "none", background: "none",
                        cursor: "pointer", padding: 4,
                        color: s.isActive ? "#10b981" : "#cbd5e1",
                        transition: "color 0.15s",
                      }}
                    >
                      {s.isActive ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={saveStaff} disabled={saving} style={btnPrimary}>
          <Save size={16} />
          {saving ? "保存中…" : "担当者リストを保存"}
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
