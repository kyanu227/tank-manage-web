"use client";

import AdminDeveloperTabs, { type AdminDeveloperTab } from "./AdminDeveloperTabs";

export default function AdminDeveloperPageShell({
  activeTab,
  children,
}: {
  activeTab: AdminDeveloperTab;
  children: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", margin: "0 0 4px" }}>
          開発者ツール
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
          状態遷移とSecurity Rulesの参照専用情報です。
        </p>
      </header>
      <AdminDeveloperTabs activeTab={activeTab} />
      {children}
    </div>
  );
}
