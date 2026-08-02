"use client";

import type { Locale } from "@/lib/locale";
import { getStaffRoleDisplayLabel } from "@/lib/staff-display";
import { getStaffShellText } from "./staff-shell-i18n";
import type { StaffAccountView } from "./staff-shell-types";
import styles from "./StaffShell.module.css";

interface StaffMenuAccountProps {
  readonly account: StaffAccountView;
  readonly locale: Locale;
}

/** 氏名の先頭1文字。サロゲートペアでも壊れないよう Array.from を使う */
function toInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}

/**
 * menu 上部のログイン中スタッフ表示。
 * 1日1回も触らない情報なので、枠・カード・アイコン枠を持たず面に直接置く。
 */
export default function StaffMenuAccount({ account, locale }: StaffMenuAccountProps) {
  const roleLabel = account.role
    ? getStaffRoleDisplayLabel(account.role, locale)
    : getStaffShellText("roleNotSet", locale);
  const rankLabel = account.rank?.trim() || getStaffShellText("rankNotSet", locale);

  return (
    <>
      <div className={styles.accountRow}>
        <div className={styles.avatar} aria-hidden="true">{toInitial(account.name)}</div>
        <div className={styles.accountBody}>
          <p className={styles.accountName} title={account.name}>{account.name}</p>
          {account.email && (
            <p className={styles.accountEmail} title={account.email}>{account.email}</p>
          )}
        </div>
      </div>
      <p className={styles.accountMeta}>
        <span>{roleLabel}</span>
        <span className={styles.accountMetaDot} aria-hidden="true" />
        <span>{rankLabel}</span>
      </p>
    </>
  );
}
