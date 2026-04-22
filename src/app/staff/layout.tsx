"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Wrench, ShoppingCart, User,
  Menu, X, Hand, Building2
} from "lucide-react";
import StaffAuthGuard from "@/components/StaffAuthGuard";

/* ── Side menu ──
   破損報告/修理完了/耐圧検査完了の3画面は「メンテナンス」グループとして
   /staff/damage を代表パスにする。3画面の切替は共通タブ (MaintenanceTabs) で行う。*/
const SIDE_NAV = [
  { href: "/staff/lend",      label: "操作 (貸出/返却/充填)", icon: Hand },
  { href: "/staff/inhouse",   label: "自社管理",       icon: Building2 },
  { href: "/staff/damage",    label: "メンテナンス",   icon: Wrench },
  { href: "/staff/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/staff/order",     label: "資材発注",       icon: ShoppingCart },
  { href: "/staff/mypage",    label: "マイページ",     icon: User },
];

// 操作ページ（貸出/返却/充填）配下の判定
const OPS_PATHS = ["/staff/lend", "/staff/return", "/staff/fill"];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  // iOS: 前画面のキーボードでズレたビューポートを強制リセット（スクロールロック画面のため手動では戻せない）
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  // 手動/受注サブタブは貸出ページでのみ表示
  const isLendPage = pathname === "/staff/lend";
  const isOpsGroup = OPS_PATHS.includes(pathname ?? "");
  const isInhousePage = pathname === "/staff/inhouse";
  const isInternalScrollPage = [
    "/staff/inhouse",
    "/staff/damage",
    "/staff/repair",
    "/staff/inspection",
    ...OPS_PATHS,
  ].includes(pathname ?? "");

  // 操作スタイル: 手動 / 受注（操作ページでのみ表示）
  const [opStyle, setOpStyle] = useState<"manual" | "order">("manual");

  const toggleOpStyle = useCallback((style: "manual" | "order") => {
    setOpStyle(style);
    window.dispatchEvent(new CustomEvent("opStyleChange", { detail: style }));
  }, []);

  return (
    <StaffAuthGuard>
      <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "#f8f9fb", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {/* Dynamic Island 等のノッチ端末でのみ高さを持つスペーサー。ヘッダー背景と一致させる */}
        <div
          aria-hidden="true"
          style={{
            height: "env(safe-area-inset-top, 0px)",
            flexShrink: 0,
            background: "rgba(255,255,255,0.9)",
          }}
        />
        {/* Header */}
        <header
          style={{
            height: 56, flexShrink: 0,
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid #e8eaed",
            display: "flex", alignItems: "center",
            padding: "0 16px", zIndex: 30,
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
          <Link
            href="/staff/inhouse"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              background: isInhousePage ? "#6366f1" : "#f1f5f9",
              color: isInhousePage ? "#fff" : "#64748b",
              fontSize: 12, fontWeight: 700, textDecoration: "none",
              marginRight: 8,
            }}
          >
            <Building2 size={14} />
            自社管理
          </Link>
          {isLendPage && (
            <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
              {([
                { id: "manual" as const, label: "手動" },
                { id: "order" as const, label: "受注" },
              ]).map(({ id, label }) => {
                const active = opStyle === id;
                return (
                  <button
                    key={id}
                    onClick={() => toggleOpStyle(id)}
                    style={{
                      padding: "5px 14px", borderRadius: 8, border: "none",
                      background: active ? "#6366f1" : "transparent",
                      color: active ? "#fff" : "#94a3b8",
                      fontSize: 12, fontWeight: active ? 800 : 600,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Slide-over menu */}
        {menuOpen && (
          <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40 }} />
        )}
        <div
          style={{
            position: "fixed", top: 0, left: 0, bottom: 0, width: 280,
            background: "#fff", zIndex: 50, borderRight: "1px solid #e8eaed",
            transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.25s ease",
            display: "flex", flexDirection: "column",
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #e8eaed", display: "flex", alignItems: "center", justifyContent: "flex-end", minHeight: 56 }}>
            <button onClick={() => setMenuOpen(false)}
              style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
              <X size={16} />
            </button>
          </div>
          <nav style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
            {SIDE_NAV.map((item) => {
              const Icon = item.icon;
              // 複数URLを束ねるグループナビは個別判定
              const isMaintenance = item.href === "/staff/damage";
              const isOpsGroupItem = item.href === "/staff/lend";
              const active = isMaintenance
                ? ["/staff/damage", "/staff/repair", "/staff/inspection"].includes(pathname ?? "")
                : isOpsGroupItem
                ? isOpsGroup
                : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 16px", borderRadius: 10, textDecoration: "none",
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    color: active ? "#6366f1" : "#64748b",
                    background: active ? "#eef2ff" : "transparent",
                    marginBottom: 1,
                  }}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div style={{ padding: "16px 24px", borderTop: "1px solid #e8eaed", fontSize: 11, color: "#94a3b8" }} />
        </div>

        {/* Main content */}
        <main
          ref={mainRef}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: isInternalScrollPage ? "hidden" : "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
          {children}
        </main>
      </div>
    </StaffAuthGuard>
  );
}
