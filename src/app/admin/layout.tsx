"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  Bell,
  BarChart3,
  Users,
  Wallet,
  FileText,
  Menu,
  X,
  ChevronLeft,
  Shield,
  LogOut,
  HardHat,
  Building2,
  ExternalLink,
  Workflow,
} from "lucide-react";
import AdminAuthGuard from "@/components/AdminAuthGuard";
import { auth } from "@/lib/firebase/config";

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "確認・分析",
    items: [
      { href: "/admin", label: "ダッシュボード", icon: LayoutDashboard },
      { href: "/admin/sales", label: "売上統計", icon: BarChart3 },
      { href: "/admin/staff-analytics", label: "スタッフ実績", icon: Users },
    ],
  },
  {
    label: "顧客・請求",
    items: [
      { href: "/admin/customers", label: "顧客管理", icon: Building2 },
      { href: "/admin/billing", label: "請求書発行", icon: FileText },
    ],
  },
  {
    label: "スタッフ・権限",
    items: [
      { href: "/admin/permissions", label: "ページ権限", icon: Shield, adminOnly: true },
    ],
  },
  {
    label: "マスタ・料金",
    items: [
      { href: "/admin/money", label: "金銭・ランク", icon: Wallet },
      { href: "/admin/settings", label: "設定変更", icon: Settings },
    ],
  },
  {
    label: "通知・外部連携",
    items: [
      { href: "/admin/notifications", label: "通知設定", icon: Bell },
    ],
  },
  {
    label: "開発・確認",
    items: [
      { href: "/admin/state-diagram", label: "状態遷移図", icon: Workflow },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [staffName, setStaffName] = useState("管理者");
  const [staffRole, setStaffRole] = useState("");
  const [allowedPaths, setAllowedPaths] = useState<string[]>([]);

  const handleStaffLoaded = useCallback((staff: { name: string; role: string }) => {
    setStaffName(staff.name);
    setStaffRole(staff.role);
  }, []);

  const handlePermissionsLoaded = useCallback((paths: string[]) => {
    setAllowedPaths(paths);
  }, []);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  // Filter nav items based on permissions, then drop empty groups
  const visibleNavGroups: AdminNavGroup[] = ADMIN_NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => {
      // adminOnly items only visible to 管理者
      if (item.adminOnly && staffRole !== "管理者") return false;
      // 管理者 sees everything
      if (staffRole === "管理者") return true;
      // 準管理者 sees only allowed paths
      return allowedPaths.includes(item.href);
    }),
  })).filter((group) => group.items.length > 0);

  const handleLogout = async () => {
    if (!confirm("ログアウトしますか？")) return;
    try {
      await auth.signOut();
      localStorage.removeItem("staffSession");
      window.location.href = "/admin";
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <AdminAuthGuard
      onStaffLoaded={handleStaffLoaded}
      onPermissionsLoaded={handlePermissionsLoaded}
    >
      <div style={{ display: "flex", minHeight: "100dvh", background: "#f8f9fb", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {/* Sidebar - Desktop */}
      <aside
        style={{
          width: collapsed ? 72 : 260,
          background: "#fff",
          borderRight: "1px solid #e8eaed",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 40,
          transition: "width 0.2s ease, transform 0.2s ease",
          transform: sidebarOpen ? "translateX(0)" : undefined,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        className="admin-sidebar-desktop"
      >
        {/* Brand */}
        <div
          style={{
            padding: collapsed ? "20px 0" : "20px 24px",
            borderBottom: "1px solid #e8eaed",
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            minHeight: 64,
          }}
        >
          {!collapsed && (
            <span
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "#1a1a2e",
                letterSpacing: "-0.02em",
              }}
            >
              管理画面
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid #e8eaed",
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#94a3b8",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
          >
            <ChevronLeft
              size={16}
              style={{
                transform: collapsed ? "rotate(180deg)" : "none",
                transition: "transform 0.2s",
              }}
            />
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visibleNavGroups.map((group) => (
              <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {!collapsed && (
                  <div
                    style={{
                      padding: "4px 16px 6px",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#94a3b8",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: collapsed ? "10px 0" : "10px 16px",
                        justifyContent: collapsed ? "center" : "flex-start",
                        borderRadius: 10,
                        textDecoration: "none",
                        fontSize: 14,
                        fontWeight: active ? 600 : 500,
                        color: active ? "#6366f1" : "#64748b",
                        background: active ? "#eef2ff" : "transparent",
                        transition: "all 0.15s",
                      }}
                    >
                      <Icon size={18} style={{ flexShrink: 0 }} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* External links */}
        <div
          style={{
            padding: "12px 8px",
            borderTop: "1px solid #e8eaed",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {!collapsed && (
            <div style={{ padding: "4px 16px 6px", fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              他画面
            </div>
          )}
          <Link
            href="/staff"
            target="_blank"
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: collapsed ? "10px 0" : "10px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 10, textDecoration: "none",
              fontSize: 14, fontWeight: 500, color: "#64748b",
              transition: "all 0.15s",
            }}
          >
            <HardHat size={18} style={{ flexShrink: 0 }} />
            {!collapsed && (
              <span style={{ flex: 1 }}>現場用</span>
            )}
            {!collapsed && <ExternalLink size={12} style={{ color: "#cbd5e1" }} />}
          </Link>
          <Link
            href="/portal"
            target="_blank"
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: collapsed ? "10px 0" : "10px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 10, textDecoration: "none",
              fontSize: 14, fontWeight: 500, color: "#64748b",
              transition: "all 0.15s",
            }}
          >
            <Building2 size={18} style={{ flexShrink: 0 }} />
            {!collapsed && (
              <span style={{ flex: 1 }}>顧客ポータル</span>
            )}
            {!collapsed && <ExternalLink size={12} style={{ color: "#cbd5e1" }} />}
          </Link>
        </div>

        {/* Footer */}
        {!collapsed && (
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #e8eaed",
              fontSize: 11,
              color: "#94a3b8",
            }}
          >
            © 2026 Tank Management System
          </div>
        )}
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 35,
          }}
          className="admin-sidebar-overlay"
        />
      )}

      {/* Mobile sidebar */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          background: "#fff",
          zIndex: 50,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #e8eaed",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        className="admin-sidebar-mobile"
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #e8eaed",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 64,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>
            管理画面
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "#f1f5f9", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "#64748b",
            }}
          >
            <X size={16} />
          </button>
        </div>
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visibleNavGroups.map((group) => (
              <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div
                  style={{
                    padding: "4px 16px 6px",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#94a3b8",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 16px", borderRadius: 10, textDecoration: "none",
                        fontSize: 14, fontWeight: active ? 600 : 500,
                        color: active ? "#6366f1" : "#64748b",
                        background: active ? "#eef2ff" : "transparent",
                      }}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid #e8eaed", paddingTop: 12 }}>
            <div style={{ padding: "4px 16px 6px", fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              他画面
            </div>
            <Link
              href="/staff"
              target="_blank"
              onClick={() => setSidebarOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 16px", borderRadius: 10, textDecoration: "none",
                fontSize: 14, fontWeight: 500, color: "#64748b",
              }}
            >
              <HardHat size={18} />
              <span style={{ flex: 1 }}>現場用</span>
              <ExternalLink size={12} style={{ color: "#cbd5e1" }} />
            </Link>
            <Link
              href="/portal"
              target="_blank"
              onClick={() => setSidebarOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 16px", borderRadius: 10, textDecoration: "none",
                fontSize: 14, fontWeight: 500, color: "#64748b",
              }}
            >
              <Building2 size={18} />
              <span style={{ flex: 1 }}>顧客ポータル</span>
              <ExternalLink size={12} style={{ color: "#cbd5e1" }} />
            </Link>
          </div>
        </nav>
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          marginLeft: collapsed ? 72 : 260,
          transition: "margin-left 0.2s ease",
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
        }}
        className="admin-main-area"
      >
        {/* Top bar */}
        <header
          style={{
            height: 64,
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid #e8eaed",
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              width: 36, height: 36, borderRadius: 8, border: "1px solid #e8eaed",
              background: "#fff", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "#64748b",
              marginRight: 16,
            }}
            className="admin-mobile-menu-btn"
          >
            <Menu size={18} />
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#f1f5f9", borderRadius: 10, padding: "6px 14px",
              }}
            >
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 12, fontWeight: 700,
                }}
              >
                {staffName.charAt(0)}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                {staffName}
              </span>
            </div>
            <button
              onClick={handleLogout}
              style={{
                width: 36, height: 36, borderRadius: 8, border: "1px solid #e2e8f0",
                background: "#fff", display: "flex", alignItems: "center",
                justifyContent: "center", cursor: "pointer", color: "#94a3b8",
                transition: "all 0.15s",
              }}
              title="ログアウト"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, padding: 24 }}>
          {children}
        </main>
      </div>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 1023px) {
          .admin-sidebar-desktop { display: none !important; }
          .admin-main-area { margin-left: 0 !important; }
        }
        @media (min-width: 1024px) {
          .admin-sidebar-mobile { display: none !important; }
          .admin-sidebar-overlay { display: none !important; }
          .admin-mobile-menu-btn { display: none !important; }
        }
      `}</style>
      </div>
    </AdminAuthGuard>
  );
}
