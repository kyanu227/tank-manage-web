"use client";

import Link from "next/link";
import type { Locale } from "@/lib/locale";
import { getStaffShellText } from "./staff-shell-i18n";
import type { StaffNavItemView } from "./staff-shell-types";
import styles from "./StaffShell.module.css";

interface StaffMenuNavProps {
  readonly items: readonly StaffNavItemView[];
  readonly locale: Locale;
  readonly onNavigate: () => void;
  readonly navRef?: React.Ref<HTMLElement>;
}

/**
 * menu 中央の遷移先一覧。
 * 弱い階層：行ごとの枠・背景・アイコン枠は持たず、active だけ右向き gradient で示す。
 */
export default function StaffMenuNav({ items, locale, onNavigate, navRef }: StaffMenuNavProps) {
  return (
    <nav
      ref={navRef}
      className={styles.nav}
      aria-label={getStaffShellText("navigation", locale)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.section}
            href={item.href}
            className={styles.navItem}
            aria-current={item.active ? "page" : undefined}
            onClick={onNavigate}
          >
            <span className={styles.navItemInner}>
              <span className={styles.navItemIcon}>
                <Icon size={16} aria-hidden="true" />
              </span>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
