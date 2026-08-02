"use client";

import AdminSettingsTabs, { type AdminSettingsTab } from "./AdminSettingsTabs";

export default function AdminSettingsPageShell({
  activeTab,
  children,
}: {
  activeTab: AdminSettingsTab;
  children: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", margin: "0 0 4px" }}>
          システム設定
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
          業務ルール、通知、運用制御を目的別に管理します。
        </p>
      </header>
      <AdminSettingsTabs activeTab={activeTab} />
      {children}
    </div>
  );
}
