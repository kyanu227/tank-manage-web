"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Wrench, ShoppingCart, User,
  Menu, X, Hand, Building2, Inbox, AlertTriangle
} from "lucide-react";
import StaffAuthGuard from "@/components/StaffAuthGuard";
import { PROCUREMENT_PATHS } from "@/features/procurement/constants";
import { usePendingOrderCount } from "@/hooks/usePendingOrderCount";
import { useStaffLocale } from "@/hooks/useStaffSession";
import { useTankOperationPolicy } from "@/hooks/useTankOperationPolicy";
import type { LocalizedText } from "@/lib/staff-display";
import type { Locale } from "@/lib/locale";

/* ── Side menu ──
   破損報告/修理完了/耐圧検査完了の3画面は「メンテナンス」グループとして
   /staff/damage を代表パスにする。3画面の切替は共通タブ (MaintenanceTabs) で行う。*/
const SIDE_NAV = [
  { href: "/staff/lend", label: { ja: "操作 (貸出/返却/充填)", en: "Operations (Lend / Return / Fill)" }, icon: Hand },
  { href: "/staff/inhouse", label: { ja: "自社管理", en: "In-house" }, icon: Building2 },
  { href: "/staff/damage", label: { ja: "メンテナンス", en: "Maintenance" }, icon: Wrench },
  { href: "/staff/dashboard", label: { ja: "ダッシュボード", en: "Dashboard" }, icon: LayoutDashboard },
  { href: "/staff/supply-order", label: { ja: "発注/タンク登録", en: "Orders / Tank entry" }, icon: ShoppingCart },
  { href: "/staff/mypage", label: { ja: "マイページ", en: "My page" }, icon: User },
] satisfies Array<{ href: string; label: LocalizedText; icon: typeof Hand }>;

const LAYOUT_TEXT = {
  openMenu: { ja: "メニューを開く", en: "Open menu" },
  closeMenu: { ja: "メニューを閉じる", en: "Close menu" },
  navigation: { ja: "スタッフメニュー", en: "Staff menu" },
  pendingOrdersTitle: { ja: "未処理の受注があります", en: "Customer orders are waiting" },
  pendingOrders: { ja: "受注", en: "Orders" },
  inhouse: { ja: "自社管理", en: "In-house" },
  manual: { ja: "手動", en: "Manual" },
  order: { ja: "受注", en: "Orders" },
  policyError: {
    ja: "方針を取得できないため厳格モードで動作します",
    en: "The policy could not be loaded. Strict mode is active.",
  },
  advisory: {
    ja: "自動補完モード中：不一致操作は現物確認後に正規手順へ展開し、管理者レビューまで正式集計を保留します",
    en: "Automatic recovery mode: mismatched operations are expanded into the valid sequence after physical verification and remain excluded from official totals until administrator review.",
  },
} satisfies Record<string, LocalizedText>;

// 操作ページ（貸出/返却/充填）配下の判定
const OPS_PATHS = ["/staff/lend", "/staff/return", "/staff/fill"];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pendingOrderCount = usePendingOrderCount();
  const locale = useStaffLocale();

  // iOS: 前画面のキーボードでズレたビューポートを強制リセット（スクロールロック画面のため手動では戻せない）
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  // 手動/受注サブタブは貸出ページでのみ表示
  const isLendPage = pathname === "/staff/lend";
  const isOpsGroup = OPS_PATHS.includes(pathname ?? "");
  const isInhousePage = pathname === "/staff/inhouse";
  const isProcurementGroup = PROCUREMENT_PATHS.includes(pathname ?? "");
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

  useEffect(() => {
    if (!menuOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusableSelector = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusable = () => Array.from(
      drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [menuOpen]);

  return (
    <StaffAuthGuard>
      <div lang={locale} style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "#f8f9fb", paddingBottom: "env(safe-area-inset-bottom)" }}>
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
            minHeight: 56, flexShrink: 0,
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid #e8eaed",
            display: "flex", alignItems: "center",
            padding: "8px 16px", zIndex: 30,
            flexWrap: "wrap", rowGap: 6,
          }}
        >
          <button
            ref={menuButtonRef}
            type="button"
            aria-controls="staff-menu-drawer"
            aria-label={LAYOUT_TEXT.openMenu[locale]}
            aria-expanded={menuOpen}
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
          {pendingOrderCount !== null && pendingOrderCount > 0 && (
            <Link
              href="/staff/lend"
              title={LAYOUT_TEXT.pendingOrdersTitle[locale]}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", borderRadius: 8,
                background: "#fef3c7",
                color: "#92400e",
                fontSize: 12, fontWeight: 800, textDecoration: "none",
                marginRight: 8,
                border: "1px solid #fde68a",
                whiteSpace: "nowrap",
              }}
            >
              <Inbox size={14} />
              {LAYOUT_TEXT.pendingOrders[locale]} {pendingOrderCount}
            </Link>
          )}
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
            {LAYOUT_TEXT.inhouse[locale]}
          </Link>
          {isLendPage && (
            <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
              {([
                { id: "manual" as const, label: LAYOUT_TEXT.manual[locale] },
                { id: "order" as const, label: LAYOUT_TEXT.order[locale] },
              ]).map(({ id, label }) => {
                const active = opStyle === id;
                return (
                  <button
                    type="button"
                    aria-pressed={active}
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

        <TankOperationPolicyBanner locale={locale} />

        {/* Slide-over menu */}
        {menuOpen && (
          <button
            type="button"
            aria-label={LAYOUT_TEXT.closeMenu[locale]}
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40, border: "none", padding: 0 }}
          />
        )}
        <div
          ref={drawerRef}
          id="staff-menu-drawer"
          role="dialog"
          aria-modal={menuOpen || undefined}
          aria-label={LAYOUT_TEXT.navigation[locale]}
          aria-hidden={!menuOpen}
          inert={!menuOpen}
          style={{
            position: "fixed", top: 0, left: 0, bottom: 0, width: "min(280px, 100vw)",
            background: "#fff", zIndex: 50, borderRight: "1px solid #e8eaed",
            transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.25s ease",
            display: "flex", flexDirection: "column",
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            pointerEvents: menuOpen ? "auto" : "none",
          }}
        >
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #e8eaed", display: "flex", alignItems: "center", justifyContent: "flex-end", minHeight: 56 }}>
            <button type="button" aria-label={LAYOUT_TEXT.closeMenu[locale]} onClick={() => setMenuOpen(false)}
              style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
              <X size={16} />
            </button>
          </div>
          <nav aria-label={LAYOUT_TEXT.navigation[locale]} style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
            {SIDE_NAV.map((item) => {
              const Icon = item.icon;
              // 複数URLを束ねるグループナビは個別判定
              const isMaintenance = item.href === "/staff/damage";
              const isOpsGroupItem = item.href === "/staff/lend";
              const isProcurementItem = item.href === "/staff/supply-order";
              const active = isMaintenance
                ? ["/staff/damage", "/staff/repair", "/staff/inspection"].includes(pathname ?? "")
                : isOpsGroupItem
                ? isOpsGroup
                : isProcurementItem
                ? isProcurementGroup
                : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? "page" : undefined}
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
                  <span style={{ minWidth: 0, lineHeight: 1.3 }}>{item.label[locale]}</span>
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

function TankOperationPolicyBanner({ locale }: { locale: Locale }) {
  const { runtimeTransitionEnforcement, loading, error } = useTankOperationPolicy();
  if (loading) return null;

  if (error) {
    return (
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          flexShrink: 0,
          padding: "6px 12px",
          background: "#fef2f2",
          borderBottom: "1px solid #fecaca",
          color: "#991b1b",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <AlertTriangle size={14} /> {LAYOUT_TEXT.policyError[locale]}
      </div>
    );
  }

  if (runtimeTransitionEnforcement !== "advisory") return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        flexShrink: 0,
        padding: "7px 12px",
        background: "#fffbeb",
        borderBottom: "1px solid #fde68a",
        color: "#92400e",
        fontSize: 11,
        fontWeight: 800,
        textAlign: "center",
      }}
    >
      <AlertTriangle size={14} />
      {LAYOUT_TEXT.advisory[locale]}
    </div>
  );
}
