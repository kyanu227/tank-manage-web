"use client";

import type { CSSProperties } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import type { StaffJoinRequest, StaffJoinRequestStatus } from "@/lib/firebase/staff-join-requests";

interface StaffJoinRequestsPanelProps {
  requests: StaffJoinRequest[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
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
  onRefresh,
}: StaffJoinRequestsPanelProps) {
  return (
    <section style={sectionStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
            スタッフ利用申請
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.7, color: "#64748b" }}>
            Firebase Auth 由来の申請情報を read-only で表示します。承認・却下はこのPRでは未実装です。
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8eaed" }}>
                {["状態", "申請者名", "Auth Email", "Auth表示名", "メッセージ", "更新日時", "紐付け/レビュー"].map((header) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
