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
  Package,
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
  ShieldCheck,
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
      { href: "/admin/staff", label: "担当者", icon: Users },
      { href: "/admin/permissions", label: "ページ権限", icon: Shield, adminOnly: true },
    ],
  },
  {
    label: "マスタ・料金",
    items: [
      { href: "/admin/money", label: "金銭・ランク", icon: Wallet },
      { href: "/admin/order-master", label: "発注品目", icon: Package },
    ],
  },
  {
    label: "設定",
    items: [
      { href: "/admin/settings/portal", label: "ポータル設定", icon: Settings },
      { href: "/admin/settings/inspection", label: "耐圧検査設定", icon: ShieldCheck },
      { href: "/admin/notifications", label: "通知設定", icon: Bell },
    ],
  },
  {
    label: "開発・確認",
    items: [
      { href: "/admin/state-diagram", label: "状態遷移図", icon: Workflow },
      { href: "/admin/security-rules", label: "Security Rules", icon: ShieldCheck, adminOnly: true },
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
  const staffInitial = staffName.trim().charAt(0) || "管";
  const staffRoleLabel = staffRole || "権限確認中";

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
        {/* User */}
        <div
          style={{
            padding: collapsed ? "14px 0" : "16px 16px",
            borderBottom: "1px solid #e8eaed",
            display: "flex",
            flexDirection: collapsed ? "column" : "row",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            gap: collapsed ? 8 : 10,
            minHeight: 76,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              justifyContent: collapsed ? "center" : "flex-start",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {staffInitial}
            </div>
            {!collapsed && (
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#1e293b",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {staffName}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
                  {staffRoleLabel}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              width: 30,
              height: 30,
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
              marginLeft: collapsed ? 0 : "auto",
            }}
            title={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
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

        {/* Sidebar actions */}
        <div
          style={{
            padding: "12px 8px",
            borderTop: "1px solid #e8eaed",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {!collapsed && (
            <div style={{ padding: "4px 16px 4px", fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              アプリ切替
            </div>
          )}
          <Link
            href="/staff"
            target="_blank"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: collapsed ? "8px 0" : "8px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 8, textDecoration: "none",
              fontSize: 12, fontWeight: 500, color: "#64748b",
              transition: "all 0.15s",
            }}
            title="現場アプリ"
          >
            <HardHat size={16} style={{ flexShrink: 0, color: "#94a3b8" }} />
            {!collapsed && (
              <span style={{ flex: 1 }}>現場アプリ</span>
            )}
            {!collapsed && <ExternalLink size={11} style={{ color: "#cbd5e1" }} />}
          </Link>
          <Link
            href="/portal"
            target="_blank"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: collapsed ? "8px 0" : "8px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 8, textDecoration: "none",
              fontSize: 12, fontWeight: 500, color: "#64748b",
              transition: "all 0.15s",
            }}
            title="顧客アプリ"
          >
            <Building2 size={16} style={{ flexShrink: 0, color: "#94a3b8" }} />
            {!collapsed && (
              <span style={{ flex: 1 }}>顧客アプリ</span>
            )}
            {!collapsed && <ExternalLink size={11} style={{ color: "#cbd5e1" }} />}
          </Link>
          <button
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: collapsed ? "9px 0" : "9px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "#64748b",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            title="ログアウト"
          >
            <LogOut size={16} style={{ flexShrink: 0, color: "#94a3b8" }} />
            {!collapsed && <span>ログアウト</span>}
          </button>
        </div>
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
            padding: "16px 20px",
            borderBottom: "1px solid #e8eaed",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            minHeight: 76,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {staffInitial}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#1e293b",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {staffName}
              </div>
              <div style={{ marginTop: 2, fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
                {staffRoleLabel}
              </div>
            </div>
          </div>
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
        </nav>
        <div style={{ borderTop: "1px solid #e8eaed", padding: "12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ padding: "4px 16px 4px", fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            アプリ切替
          </div>
          <Link
            href="/staff"
            target="_blank"
            onClick={() => setSidebarOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 16px", borderRadius: 8, textDecoration: "none",
              fontSize: 12, fontWeight: 500, color: "#64748b",
            }}
          >
            <HardHat size={16} style={{ color: "#94a3b8" }} />
            <span style={{ flex: 1 }}>現場アプリ</span>
            <ExternalLink size={11} style={{ color: "#cbd5e1" }} />
          </Link>
          <Link
            href="/portal"
            target="_blank"
            onClick={() => setSidebarOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 16px", borderRadius: 8, textDecoration: "none",
              fontSize: 12, fontWeight: 500, color: "#64748b",
            }}
          >
            <Building2 size={16} style={{ color: "#94a3b8" }} />
            <span style={{ flex: 1 }}>顧客アプリ</span>
            <ExternalLink size={11} style={{ color: "#cbd5e1" }} />
          </Link>
          <button
            onClick={handleLogout}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 16px", borderRadius: 8, border: "none",
              background: "transparent", color: "#64748b", fontSize: 12,
              fontWeight: 600, cursor: "pointer",
            }}
          >
            <LogOut size={16} style={{ color: "#94a3b8" }} />
            <span>ログアウト</span>
          </button>
        </div>
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
        {/* Page content */}
        <main style={{ flex: 1, padding: 24 }}>
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              width: 36, height: 36, borderRadius: 8, border: "1px solid #e8eaed",
              background: "#fff", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "#64748b",
              marginBottom: 16,
            }}
            className="admin-mobile-menu-btn"
            aria-label="管理メニューを開く"
          >
            <Menu size={18} />
          </button>
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
