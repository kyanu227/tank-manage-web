import type React from "react";

export type DashboardSectionLabelProps = {
  icon: React.ReactNode;
  title: string;
  tone?: "alert";
};

export function DashboardSectionLabel({
  icon,
  title,
  tone,
}: DashboardSectionLabelProps) {
  const color = tone === "alert" ? "#dc2626" : "#475569";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 4px 10px" }}>
      <span style={{ color, display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: "0.06em" }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: "#e2e8f0", marginLeft: 4 }} />
    </div>
  );
}
