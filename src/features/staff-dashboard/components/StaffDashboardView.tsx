import type React from "react";
import { Loader2 } from "lucide-react";
import { getDashboardText, formatDashboardStaffName } from "@/features/staff-dashboard/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

export type StaffDashboardViewProps = {
  staffName: string | null;
  loading: boolean;
  children: React.ReactNode;
  overlays: React.ReactNode;
  locale?: Locale;
  loadFailed?: boolean;
  showLoadWarning?: boolean;
  onRetry?: () => void;
};

export function StaffDashboardView({
  staffName,
  loading,
  children,
  overlays,
  locale = DEFAULT_LOCALE,
  loadFailed = false,
  showLoadWarning = false,
  onRetry,
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
              {getDashboardText("dashboard", locale)}
            </h1>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              {getDashboardText("dashboardSubtitle", locale)}
            </p>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, whiteSpace: "nowrap" }}>
            {staffName ? formatDashboardStaffName(staffName, locale) : ""}
          </div>
        </div>

        {loading ? (
          <div
            role="status"
            aria-live="polite"
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
            {getDashboardText("loading", locale)}
          </div>
        ) : loadFailed ? (
          <div role="alert" style={{ textAlign: "center", padding: 40, color: "#991b1b", background: "#fff", borderRadius: 16, border: "1px solid #fecaca" }}>
            <p>{getDashboardText("loadFailure", locale)}</p>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                {getDashboardText("retry", locale)}
              </button>
            )}
          </div>
        ) : (
          <>
            {showLoadWarning && (
              <div role="alert" style={{ marginBottom: 14, padding: "10px 12px", color: "#9a3412", background: "#fff7ed", borderRadius: 10, border: "1px solid #fed7aa", fontSize: 12 }}>
                {getDashboardText("loadFailure", locale)}
                {onRetry && (
                  <button type="button" onClick={onRetry} style={{ marginLeft: 8 }}>
                    {getDashboardText("retry", locale)}
                  </button>
                )}
              </div>
            )}
            {children}
          </>
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
