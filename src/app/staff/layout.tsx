"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import StaffAuthGuard from "@/components/StaffAuthGuard";
import StaffShell from "@/components/staff-shell/StaffShell";
import StaffHeader from "@/components/staff-shell/StaffHeader";
import StaffMenuSheet from "@/components/staff-shell/StaffMenuSheet";
import StaffPolicyBanner from "@/components/staff-shell/StaffPolicyBanner";
import {
  getStaffNavItems,
  resolveStaffPrimarySection,
  resolveStaffSection,
} from "@/components/staff-shell/staff-nav-items";
import { useStaffLocaleSetting } from "@/components/staff-shell/useStaffLocaleSetting";
import { useStaffMenuGesture } from "@/components/staff-shell/useStaffMenuGesture";
import { useStaffMenuController } from "@/components/staff-shell/useStaffMenuController";
import {
  useStaffHeaderElevation,
  useStaffViewportLock,
} from "@/components/staff-shell/useStaffViewport";
import type { StaffAccountView } from "@/components/staff-shell/staff-shell-types";
import { usePendingOrderCount } from "@/hooks/usePendingOrderCount";
import { useStaffLocale, useStaffSession } from "@/hooks/useStaffSession";
import { useTankOperationPolicy } from "@/hooks/useTankOperationPolicy";
import { resolveStaffViewportMode } from "@/lib/staff-viewport-policy";

/** 手動／受注サブタブは貸出ページでのみ表示する */
const OP_STYLE_PATH = "/staff/lend";

/**
 * staff 画面の composition 層。
 *
 * 見た目は components/staff-shell/ が持ち、ここは state と依存の接続だけを行う。
 * viewport policy は lib/staff-viewport-policy が唯一の判断元。
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const locale = useStaffLocale();
  const session = useStaffSession();
  const pendingOrderCount = usePendingOrderCount();
  const menuId = useId();
  const mainRef = useRef<HTMLElement | null>(null);

  const viewportMode = resolveStaffViewportMode(pathname);
  const section = resolveStaffSection(pathname);
  const menu = useStaffMenuController(pathname);
  useStaffMenuGesture({
    menuOpen: menu.open,
    onOpen: menu.openMenu,
    onClose: menu.close,
    scrollRegionRef: menu.scrollRegionRef,
  });
  const localeSetting = useStaffLocaleSetting(locale);
  const elevated = useStaffHeaderElevation(viewportMode);
  useStaffViewportLock(viewportMode);

  // iOS: 前画面のキーボードでズレたビューポートを強制リセット
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  // 操作スタイル: 手動 / 受注（貸出ページでのみ表示）
  const [opStyle, setOpStyle] = useState<"manual" | "order">("manual");
  const toggleOpStyle = useCallback(() => {
    setOpStyle((current) => {
      const next = current === "manual" ? "order" : "manual";
      window.dispatchEvent(new CustomEvent("opStyleChange", { detail: next }));
      return next;
    });
  }, []);

  const account: StaffAccountView | null = session
    ? {
        name: session.name,
        ...(session.email ? { email: session.email } : {}),
        ...(session.role ? { role: session.role } : {}),
        ...(session.rank ? { rank: session.rank } : {}),
      }
    : null;

  return (
    <StaffAuthGuard>
      <StaffShell
        locale={locale}
        viewportMode={viewportMode}
        scrolled={elevated}
        mainRef={mainRef}
        header={
          <StaffHeader
            locale={locale}
            menuOpen={menu.open}
            menuId={menuId}
            pendingOrderCount={pendingOrderCount}
            opStyle={pathname === OP_STYLE_PATH ? opStyle : undefined}
            onToggleOpStyle={pathname === OP_STYLE_PATH ? toggleOpStyle : undefined}
            onToggleMenu={menu.toggle}
            menuButtonRef={menu.triggerRef}
          />
        }
        banner={<TankOperationPolicyBanner locale={locale} />}
        menu={
          <StaffMenuSheet
            open={menu.open}
            id={menuId}
            locale={locale}
            account={account}
            navItems={getStaffNavItems(locale, section)}
            activePrimary={resolveStaffPrimarySection(section)}
            pendingOrderCount={pendingOrderCount}
            localeValue={locale}
            localeStatus={localeSetting.status}
            localeErrorMessage={localeSetting.errorMessage}
            onLocaleChange={localeSetting.save}
            onClose={menu.close}
            onNavigate={menu.close}
            sheetRef={menu.sheetRef}
            closeButtonRef={menu.closeButtonRef}
            backdropRef={menu.backdropRef}
            scrollRegionRef={menu.scrollRegionRef}
          />
        }
      >
        {children}
      </StaffShell>
    </StaffAuthGuard>
  );
}

function TankOperationPolicyBanner({ locale }: { locale: ReturnType<typeof useStaffLocale> }) {
  const { runtimeTransitionEnforcement, loading, error } = useTankOperationPolicy();
  if (loading) return null;
  if (error) return <StaffPolicyBanner variant="error" locale={locale} />;
  if (runtimeTransitionEnforcement !== "advisory") return null;
  return <StaffPolicyBanner variant="advisory" locale={locale} />;
}
