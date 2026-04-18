"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Wrench, ShieldCheck } from "lucide-react";

/**
 * メンテナンス共通タブバー
 *
 * - `/staff/damage` / `/staff/repair` / `/staff/inspection` の3画面上部に配置
 * - URL はそのまま分割（遷移は Link）
 * - 現在のパスに応じてアクティブ表示を切り替える
 */
const TABS = [
  { href: "/staff/damage",     label: "破損報告",       icon: AlertTriangle, color: "#ef4444" },
  { href: "/staff/repair",     label: "修理完了",       icon: Wrench,        color: "#0ea5e9" },
  { href: "/staff/inspection", label: "耐圧検査完了",   icon: ShieldCheck,   color: "#8b5cf6" },
];

export default function MaintenanceTabs() {
  const pathname = usePathname();
  return (
    <div style={{
      padding: "12px 16px", background: "rgba(255,255,255,0.8)",
      backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0",
      zIndex: 10, flexShrink: 0,
    }}>
      <div style={{ display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "8px 0", borderRadius: 10, textDecoration: "none",
                background: active ? "#fff" : "transparent",
                color: active ? tab.color : "#94a3b8",
                fontWeight: active ? 800 : 600, fontSize: 12,
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow: active ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
