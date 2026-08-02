"use client";

import { AlertTriangle } from "lucide-react";
import type { Locale } from "@/lib/locale";
import { getStaffShellText } from "./staff-shell-i18n";
import styles from "./StaffShell.module.css";

interface StaffPolicyBannerProps {
  readonly variant: "advisory" | "error";
  readonly locale: Locale;
}

/**
 * 遷移方針バナー（表示のみ）。方針の取得は composition 層が行う。
 * 硬い境界線は持たず、面の色だけで header と区別する。
 */
export default function StaffPolicyBanner({ variant, locale }: StaffPolicyBannerProps) {
  const isError = variant === "error";
  return (
    <div
      role="status"
      className={`${styles.banner} ${isError ? styles.bannerError : styles.bannerAdvisory}`}
    >
      <AlertTriangle className={styles.bannerIcon} size={14} aria-hidden="true" />
      {getStaffShellText(isError ? "policyError" : "advisory", locale)}
    </div>
  );
}
