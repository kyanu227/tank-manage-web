"use client";

import Link from "next/link";
import { ChevronRight, Settings, Wrench } from "lucide-react";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { hasAdminCapability, type AdminCapability } from "@/lib/admin/adminCapabilities";
import AdminPopoverMenu from "./AdminPopoverMenu";
import styles from "./AdminNavigation.module.css";

export function resolveAdminLauncherLinks(
  capabilities: readonly AdminCapability[],
  role: string,
): { settingsHref: string | null; developerHref: string | null } {
  const settingsHref = hasAdminCapability(capabilities, "settings.businessRules.view")
    ? "/admin/settings"
    : hasAdminCapability(capabilities, "settings.notifications.view")
      ? "/admin/notifications"
      : hasAdminCapability(capabilities, "settings.operationMode.view")
        ? "/admin/settings/tank-operations"
        : null;
  const developerHref = role === "管理者"
    ? hasAdminCapability(capabilities, "developer.stateDiagram.view")
      ? "/admin/state-diagram"
      : hasAdminCapability(capabilities, "developer.securityRules.view")
        ? "/admin/security-rules"
        : null
    : null;
  return { settingsHref, developerHref };
}

export default function AdminSettingsLauncher({ centered = false }: { centered?: boolean }) {
  const { capabilities, role } = useAdminCapabilities();
  const { settingsHref, developerHref } = resolveAdminLauncherLinks(capabilities, role);
  const disabled = !settingsHref && !developerHref;

  return (
    <AdminPopoverMenu
      ariaLabel="設定メニュー"
      title={disabled ? "利用できる設定はありません" : "設定"}
      icon={<Settings size={19} />}
      disabled={disabled}
      centered={centered}
    >
      <>
          <p className={styles.popoverHeading}>設定</p>
          {settingsHref && (
            <Link className={styles.popoverLink} href={settingsHref} role="menuitem">
              <Settings size={17} />
              システム設定
              <ChevronRight size={14} />
            </Link>
          )}
          {developerHref && (
            <Link className={styles.popoverLink} href={developerHref} role="menuitem">
              <Wrench size={17} />
              開発者ツール
              <ChevronRight size={14} />
            </Link>
          )}
      </>
    </AdminPopoverMenu>
  );
}
