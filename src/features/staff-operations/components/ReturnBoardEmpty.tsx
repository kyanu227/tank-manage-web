"use client";

import { CheckCircle2 } from "lucide-react";
import type { Locale } from "@/lib/locale";
import { getStaffOperationText } from "../i18n";
import styles from "../styles/OperationsTerminal.module.css";

/**
 * 返却一覧で全区分が対象ゼロのときだけ出る空状態。
 * エラー色は使わず、次の一手（手動返却）を残す。
 */
export default function ReturnBoardEmpty({ locale }: { locale: Locale }) {
  return (
    <div className={styles.returnEmpty}>
      <span className={styles.returnEmptyMark} aria-hidden="true">
        <CheckCircle2 size={22} />
      </span>
      <p className={styles.returnEmptyTitle}>
        {getStaffOperationText("returnBoardEmptyTitle", locale)}
      </p>
      <p className={styles.returnEmptyHelp}>
        {getStaffOperationText("returnBoardEmptyHelp", locale)}
      </p>
    </div>
  );
}
