"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import StaffAuthGuard from "@/components/StaffAuthGuard";

const NAV_ITEMS = [
  { href: "/admin", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/admin/settings", label: "設定変更", icon: Settings },
  { href: "/admin/notifications", label: "通知設定", icon: Bell },
  { href: "/admin/sales", label: "売上統計", icon: BarChart3 },
  { href: "/admin/staff-analytics", label: "スタッフ実績", icon: Users },
  { href: "/admin/money", label: "金銭・ランク", icon: Wallet },
  { href: "/admin/billing", label: "請求書発行", icon: FileText },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [staffName, setStaffName] = useState("管理者");

  useEffect(() => {
    const loadUser = () => {
      const session = localStorage.getItem("staffSession");
      if (session) {
        try {
          const user = JSON.parse(session);
          setStaffName(user.name);
        } catch (e) {}
      }
    };
    loadUser();
    window.addEventListener("staffLogin", loadUser);
    return () => window.removeEventListener("staffLogin", loadUser);
  }, []);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  return (
    <StaffAuthGuard allowedRoles={["管理者", "準管理者"]}>
      <div style={{ display: "flex", minHeight: "100dvh", background: "#f8f9fb" }}>
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
              タンク管理
              <span style={{ color: "#6366f1", marginLeft: 4 }}>Admin</span>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map((item) => {
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
        </nav>

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
            タンク管理<span style={{ color: "#6366f1", marginLeft: 4 }}>Admin</span>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map((item) => {
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
    </StaffAuthGuard>
  );
}
