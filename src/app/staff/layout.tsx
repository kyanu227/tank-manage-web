"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpFromLine, ArrowDownToLine, Droplets,
  LayoutDashboard, AlertTriangle, Wrench, ShoppingCart, User,
  Menu, X, ClipboardList, CheckSquare
} from "lucide-react";
import StaffAuthGuard from "@/components/StaffAuthGuard";

const SIDE_NAV = [
  { href: "/staff", label: "操作 (貸出/返却/充填)", icon: ArrowUpFromLine },
  { href: "/staff/orders", label: "受注管理", icon: ClipboardList },
  { href: "/staff/returns", label: "返却承認", icon: CheckSquare },
  { href: "/staff/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/staff/inhouse", label: "自社管理", icon: Wrench },
  { href: "/staff/bulk-return", label: "一括返却", icon: ArrowDownToLine },
  { href: "/staff/damage", label: "破損報告", icon: AlertTriangle },
  { href: "/staff/maintenance", label: "メンテナンス", icon: Wrench },
  { href: "/staff/order", label: "資材発注", icon: ShoppingCart },
  { href: "/staff/mypage", label: "マイページ", icon: User },
];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [staffName, setStaffName] = useState("スタッフ");

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

  return (
    <StaffAuthGuard>
      <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "#f8f9fb" }}>
      {/* Header */}
      <header
        style={{
          height: 56,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid #e8eaed",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <button
          onClick={() => setMenuOpen(true)}
          style={{
            width: 36, height: 36, borderRadius: 8,
            border: "1px solid #e8eaed", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#64748b",
          }}
        >
          <Menu size={18} />
        </button>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#f1f5f9", borderRadius: 8, padding: "5px 10px",
          }}
        >
          <div
            style={{
              width: 24, height: 24, borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 10, fontWeight: 700,
            }}
          >
            {staffName.charAt(0)}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
            {staffName}
          </span>
        </div>
      </header>

      {/* Slide-over menu */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40 }}
        />
      )}
      <div
        style={{
          position: "fixed", top: 0, left: 0, bottom: 0, width: 280,
          background: "#fff", zIndex: 50, borderRight: "1px solid #e8eaed",
          transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease",
          display: "flex", flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "20px 24px", borderBottom: "1px solid #e8eaed",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            minHeight: 56,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>
            タンク管理<span style={{ color: "#6366f1", marginLeft: 4 }}>Operate</span>
          </span>
          <button
            onClick={() => setMenuOpen(false)}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "#f1f5f9", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "#64748b",
            }}
          >
            <X size={16} />
          </button>
        </div>
        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {SIDE_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", borderRadius: 10, textDecoration: "none",
                  fontSize: 14, fontWeight: active ? 600 : 500,
                  color: active ? "#6366f1" : "#64748b",
                  background: active ? "#eef2ff" : "transparent",
                  marginBottom: 2,
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #e8eaed", fontSize: 11, color: "#94a3b8" }}>
          <Link href="/admin" style={{ color: "#94a3b8", textDecoration: "none", fontSize: 12 }}>
            管理画面へ →
          </Link>
        </div>
      </div>

      {/* Main content */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "hidden" }}>
        {children}
      </main>
      </div>
    </StaffAuthGuard>
  );
}
