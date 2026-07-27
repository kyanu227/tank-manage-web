import type React from "react";
import { Loader2 } from "lucide-react";

export type StaffDashboardViewProps = {
  staffName: string | null;
  loading: boolean;
  children: React.ReactNode;
  overlays: React.ReactNode;
};

export function StaffDashboardView({
  staffName,
  loading,
  children,
  overlays,
}: StaffDashboardViewProps) {
  return (
    <div style={{ minHeight: "100%", background: "#f8fafc", padding: "14px 14px 32px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
            padding: "0 4px",
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
              ダッシュボード
            </h1>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              ステータス別内訳 / 業務状況 / 操作ログ
            </p>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, whiteSpace: "nowrap" }}>
            {staffName ? `${staffName} さん` : ""}
          </div>
        </div>

        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: 60,
              color: "#94a3b8",
              fontSize: 14,
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #e8eaed",
            }}
          >
            <Loader2 size={22} style={{ animation: "spin 1s linear infinite", verticalAlign: "middle", marginRight: 8 }} />
            読み込み中...
          </div>
        ) : (
          children
        )}
      </div>

      {overlays}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .dashboard-log-row {
          display: grid;
          grid-template-columns: auto auto 1fr auto;
          gap: 8px;
          align-items: center;
          padding: 9px 10px;
        }

        .dashboard-log-row--editing {
          grid-template-columns: 20px auto auto 1fr auto auto;
        }

        @media (max-width: 720px) {
          .dashboard-log-row {
            grid-template-columns: auto auto 1fr;
          }
          .dashboard-log-row--editing {
            grid-template-columns: 20px auto auto 1fr;
          }
          .dashboard-log-time,
          .dashboard-log-actions {
            grid-column: 1 / -1;
          }
          .dashboard-log-row--editing .dashboard-log-time,
          .dashboard-log-row--editing .dashboard-log-actions {
            grid-column: 2 / -1;
          }
          .dashboard-log-actions {
            justify-content: flex-start !important;
          }
        }
      `}</style>
    </div>
  );
}
