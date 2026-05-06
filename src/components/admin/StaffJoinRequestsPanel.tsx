"use client";

import { useState, type CSSProperties } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import type { StaffJoinRequest, StaffJoinRequestStatus } from "@/lib/firebase/staff-join-requests";

export type StaffJoinRequestStaffOption = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  rank?: string;
  isActive: boolean;
  authUid?: string;
};

interface StaffJoinRequestsPanelProps {
  requests: StaffJoinRequest[];
  loading: boolean;
  error: string;
  staffOptions: StaffJoinRequestStaffOption[];
  reviewer: { staffId: string; staffName: string } | null;
  actionLoadingUid?: string | null;
  actionError?: string;
  onRefresh: () => void;
  onApproveExistingStaff: (uid: string, staffId: string) => Promise<void>;
  onReject: (uid: string, rejectionReason?: string) => Promise<void>;
}

const statusMeta: Record<StaffJoinRequestStatus, { label: string; color: string; bg: string; icon: typeof Clock3 }> = {
  pending: { label: "承認待ち", color: "#d97706", bg: "#fffbeb", icon: Clock3 },
  approved: { label: "承認済み", color: "#16a34a", bg: "#ecfdf5", icon: CheckCircle2 },
  rejected: { label: "却下済み", color: "#dc2626", bg: "#fef2f2", icon: XCircle },
};

const sectionStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  background: "#fff",
  padding: 18,
  marginBottom: 20,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
};

const refreshButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#475569",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const selectStyle: CSSProperties = {
  width: "100%",
  minWidth: 180,
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  background: "#fff",
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
};

const textInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 180,
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  background: "#fff",
  color: "#334155",
  fontSize: 12,
  boxSizing: "border-box",
};

const actionButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function formatDateTime(value: unknown): string {
  if (!value) return "-";
  if (value instanceof Date) return value.toLocaleString("ja-JP");
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") {
      const date = toDate.call(value);
      if (date instanceof Date) return date.toLocaleString("ja-JP");
    }
  }
  return "-";
}

function StatusBadge({ status }: { status: StaffJoinRequestStatus }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "4px 8px",
      borderRadius: 999,
      background: meta.bg,
      color: meta.color,
      fontSize: 11,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}>
      <Icon size={13} />
      {meta.label}
    </span>
  );
}

export default function StaffJoinRequestsPanel({
  requests,
  loading,
  error,
  staffOptions,
  reviewer,
  actionLoadingUid = null,
  actionError = "",
  onRefresh,
  onApproveExistingStaff,
  onReject,
}: StaffJoinRequestsPanelProps) {
  const [selectedStaffIds, setSelectedStaffIds] = useState<Record<string, string>>({});
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

  const reviewerMissing = !reviewer;

  const setSelectedStaffId = (uid: string, staffId: string) => {
    setSelectedStaffIds((prev) => ({ ...prev, [uid]: staffId }));
  };

  const setRejectionReason = (uid: string, reason: string) => {
    setRejectionReasons((prev) => ({ ...prev, [uid]: reason }));
  };

  const renderActionControls = (request: StaffJoinRequest) => {
    if (request.status !== "pending") {
      return <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 700 }}>操作なし</span>;
    }

    const selectedStaffId = selectedStaffIds[request.uid] ?? "";
    const selectedStaff = staffOptions.find((staff) => staff.id === selectedStaffId);
    const rowLoading = actionLoadingUid === request.uid;
    const canApprove = !reviewerMissing && !rowLoading && selectedStaff !== undefined && !selectedStaff.authUid;
    const canReject = !reviewerMissing && !rowLoading;
    const rejectionReason = rejectionReasons[request.uid] ?? "";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 230 }}>
        <select
          value={selectedStaffId}
          disabled={rowLoading || reviewerMissing}
          onChange={(e) => setSelectedStaffId(request.uid, e.target.value)}
          style={selectStyle}
        >
          <option value="">既存スタッフを選択</option>
          {staffOptions.map((staff) => {
            const linked = Boolean(staff.authUid);
            const labelParts = [
              staff.name || staff.id,
              staff.email || "",
              staff.role || "",
              linked ? "UID紐付け済み" : "",
            ].filter(Boolean);
            return (
              <option key={staff.id} value={staff.id} disabled={linked}>
                {labelParts.join(" / ")}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          disabled={!canApprove}
          onClick={() => void onApproveExistingStaff(request.uid, selectedStaffId)}
          style={{
            ...actionButtonStyle,
            background: canApprove ? "#16a34a" : "#bbf7d0",
            color: "#fff",
            cursor: canApprove ? "pointer" : "not-allowed",
          }}
        >
          {rowLoading ? "処理中…" : "既存スタッフに紐付けて承認"}
        </button>
        <input
          value={rejectionReason}
          disabled={rowLoading || reviewerMissing}
          onChange={(e) => setRejectionReason(request.uid, e.target.value)}
          placeholder="却下理由 任意"
          style={textInputStyle}
        />
        <button
          type="button"
          disabled={!canReject}
          onClick={() => void onReject(request.uid, rejectionReason)}
          style={{
            ...actionButtonStyle,
            background: canReject ? "#dc2626" : "#fecaca",
            color: "#fff",
            cursor: canReject ? "pointer" : "not-allowed",
          }}
        >
          {rowLoading ? "処理中…" : "却下"}
        </button>
      </div>
    );
  };

  return (
    <section style={sectionStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
            スタッフ利用申請
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.7, color: "#64748b" }}>
            Firebase Auth 由来の申請情報を表示します。承認は既存スタッフへの紐付けのみ対応し、新規スタッフ作成付き承認は未実装です。
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} style={{ ...refreshButtonStyle, opacity: loading ? 0.65 : 1 }}>
          <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
          再読み込み
        </button>
      </div>

      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 12,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        color: "#475569",
        fontSize: 12,
        lineHeight: 1.7,
        marginBottom: 14,
      }}>
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0 }}>
          ここでの authEmail / authDisplayName は Firebase Authentication 由来の snapshot です。管理者権限や承認済み状態を意味しません。
        </p>
      </div>

      {reviewerMissing && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 12,
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          color: "#9a3412",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.7,
          marginBottom: 14,
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0 }}>管理者セッションを取得できません。承認・却下するには再ログインしてください。</p>
        </div>
      )}

      {error && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 12,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#991b1b",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.7,
          marginBottom: 14,
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {actionError && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 12,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#991b1b",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.7,
          marginBottom: 14,
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0 }}>{actionError}</p>
        </div>
      )}

      {loading && requests.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 13, fontWeight: 700 }}>
          申請一覧を読み込み中…
        </div>
      ) : requests.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 13, fontWeight: 700 }}>
          申請はありません。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                {["状態", "申請者名", "Auth Email", "Auth表示名", "メッセージ", "更新日時", "紐付け/レビュー", "操作"].map((header) => (
                  <th key={header} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 800, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.uid} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px" }}><StatusBadge status={request.status} /></td>
                  <td style={{ padding: "12px", fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                    {request.requestedName || "-"}
                    <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "#94a3b8", wordBreak: "break-all" }}>
                      UID: {request.uid}
                    </div>
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, color: "#334155", wordBreak: "break-all" }}>
                    {request.authEmail || "-"}
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, color: "#334155" }}>
                    {request.authDisplayName || "-"}
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, color: "#475569", minWidth: 180, whiteSpace: "pre-wrap" }}>
                    {request.message || "-"}
                    {request.rejectionReason && (
                      <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 700 }}>
                        却下理由: {request.rejectionReason}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                    <div>更新: {formatDateTime(request.updatedAt)}</div>
                    <div style={{ marginTop: 4 }}>作成: {formatDateTime(request.createdAt)}</div>
                  </td>
                  <td style={{ padding: "12px", fontSize: 12, color: "#64748b", minWidth: 150 }}>
                    <div>linkedStaffId: {request.linkedStaffId || "-"}</div>
                    <div style={{ marginTop: 4 }}>reviewedBy: {request.reviewedByStaffName || "-"}</div>
                  </td>
                  <td style={{ padding: "12px", verticalAlign: "top" }}>
                    {renderActionControls(request)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
