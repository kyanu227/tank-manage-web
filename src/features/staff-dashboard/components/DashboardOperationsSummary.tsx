import type React from "react";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  Users,
} from "lucide-react";
import { DashboardSectionLabel } from "@/features/staff-dashboard/components/DashboardSectionLabel";

export type DashboardCustomerLoanRowView = Readonly<{
  key: string;
  displayName: string;
  lent: number;
  unreturned: number;
}>;

export type DashboardTodayOperationRowView = Readonly<{
  action: string;
  count: number;
}>;

export type DashboardUnfilledReportRowView = Readonly<{
  id: string;
  tankId: string;
  customerName: string;
  customerTitle: string;
  statusLabel: string;
  timeLabel: string;
  sourceLabel: string;
}>;

export type DashboardOperationsSummaryProps = {
  customerLoans: readonly DashboardCustomerLoanRowView[];
  todayTotal: number;
  todayOperations: readonly DashboardTodayOperationRowView[];
  unfilledReportCount: number;
  recentUnfilledReports: readonly DashboardUnfilledReportRowView[];
};

export function DashboardOperationsSummary({
  customerLoans,
  todayTotal,
  todayOperations,
  unfilledReportCount,
  recentUnfilledReports,
}: DashboardOperationsSummaryProps) {
  return (
    <>
      <DashboardSectionLabel icon={<ClipboardList size={14} />} title="業務状況" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 10,
          marginBottom: 22,
        }}
      >
        <DashboardPanel
          icon={<Users size={14} color="#3b82f6" />}
          title="貸出先別"
          badge={`${customerLoans.length}件`}
          emptyText="貸出中のタンクはありません"
          isEmpty={customerLoans.length === 0}
        >
          {customerLoans.map((row) => (
            <div
              key={row.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "#f8fafc",
                border: "1px solid #eef2f7",
              }}
            >
              <span
                title={row.displayName}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#0f172a",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.displayName}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#3b82f6", background: "#eff6ff", padding: "2px 8px", borderRadius: 6 }}>
                貸出 {row.lent}
              </span>
              {row.unreturned > 0 ? (
                <span style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", background: "#f5f3ff", padding: "2px 8px", borderRadius: 6 }}>
                  未返却 {row.unreturned}
                </span>
              ) : (
                <span style={{ width: 60 }} />
              )}
            </div>
          ))}
        </DashboardPanel>

        <DashboardPanel
          icon={<Clock size={14} color="#0ea5e9" />}
          title="今日の操作"
          badge={`${todayTotal}件`}
          emptyText="本日の操作はまだありません"
          isEmpty={todayOperations.length === 0}
        >
          {todayOperations.map((row) => (
            <div
              key={row.action}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "#f8fafc",
                border: "1px solid #eef2f7",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{row.action}</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#0f172a",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  minWidth: 28,
                  textAlign: "right",
                }}
              >
                {row.count}
              </span>
            </div>
          ))}
        </DashboardPanel>

        <DashboardPanel
          icon={<AlertTriangle size={14} color="#dc2626" />}
          title="顧客未充填報告"
          badge={`${unfilledReportCount}件`}
          emptyText="顧客未充填報告はありません"
          isEmpty={recentUnfilledReports.length === 0}
        >
          {recentUnfilledReports.map((report) => (
            <div
              key={report.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                padding: "9px 10px",
                borderRadius: 8,
                background: "#fff7ed",
                border: "1px solid #fed7aa",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#9a3412",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  {report.tankId}
                </span>
                <span
                  title={report.customerTitle}
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#0f172a",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {report.customerName}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#b45309",
                    background: "#ffedd5",
                    padding: "2px 7px",
                    borderRadius: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  {report.statusLabel}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "#9a3412", fontWeight: 700 }}>
                <span>{report.timeLabel}</span>
                <span>{report.sourceLabel}</span>
                <span>read-only</span>
              </div>
            </div>
          ))}
        </DashboardPanel>
      </div>
    </>
  );
}

function DashboardPanel({
  icon,
  title,
  badge,
  emptyText,
  isEmpty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  emptyText: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>{badge}</span>
      </div>
      {isEmpty ? (
        <div style={{ fontSize: 12, color: "#cbd5e1", padding: "18px 0", textAlign: "center" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>{children}</div>
      )}
    </div>
  );
}
