import { Layers } from "lucide-react";
import { DashboardSectionLabel } from "@/features/staff-dashboard/components/DashboardSectionLabel";

export type DashboardStatusItemView = Readonly<{
  key: string;
  label: string;
  count: number;
  color: string;
}>;

export type DashboardStatusSummaryProps = {
  totalTanks: number;
  items: readonly DashboardStatusItemView[];
};

export function DashboardStatusSummary({
  totalTanks,
  items,
}: DashboardStatusSummaryProps) {
  return (
    <>
      <DashboardSectionLabel icon={<Layers size={14} />} title="ステータス別内訳" />
      <div
        style={{
          background: "#fff",
          border: "1px solid #e8eaed",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>総本数</span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: "#0f172a",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            {totalTanks}
            <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginLeft: 4 }}>本</span>
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((item) => (
            <div
              key={item.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 8,
                background: "#f8fafc",
                border: "1px solid #eef2f7",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>{item.label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                {item.count}
              </span>
            </div>
          ))}
          {totalTanks === 0 && <span style={{ fontSize: 12, color: "#cbd5e1", padding: 4 }}>タンクが未登録です</span>}
        </div>
      </div>
    </>
  );
}
