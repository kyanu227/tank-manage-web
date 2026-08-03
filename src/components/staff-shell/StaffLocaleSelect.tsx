"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { normalizeLocale, SUPPORTED_LOCALES, type Locale } from "@/lib/locale";
import { getLocaleOptionLabel } from "@/lib/staff-display";
import { getStaffShellText } from "./staff-shell-i18n";
import type { StaffLocaleStatus } from "./staff-shell-types";
import styles from "./StaffShell.module.css";

interface StaffLocaleSelectProps {
  readonly value: Locale;
  readonly uiLocale: Locale;
  readonly status: StaffLocaleStatus;
  readonly errorMessage?: string;
  readonly onChange: (locale: Locale) => void;
}

/**
 * 表示言語の選択。
 *
 * - SUPPORTED_LOCALES を列挙するプルダウン。locale が増えても要素は増えない
 * - 保存ボタンを持たない（選択時保存）。保存中は disabled で二重送信を防ぐ
 * - data-swipe-ignore: select 操作を menu の開閉ジェスチャーと誤認させない
 */
export default function StaffLocaleSelect({
  value,
  uiLocale,
  status,
  errorMessage,
  onChange,
}: StaffLocaleSelectProps) {
  const selectId = useId();
  const saving = status === "saving";

  return (
    <div data-swipe-ignore="true">
      <div className={styles.locale}>
        <label className={styles.localeLabel} htmlFor={selectId}>
          {getStaffShellText("displayLanguage", uiLocale)}
        </label>
        <div className={styles.localeControl}>
          <select
            id={selectId}
            className={styles.localeSelect}
            value={value}
            disabled={saving}
            aria-busy={saving}
            onChange={(event) => onChange(normalizeLocale(event.target.value))}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {getLocaleOptionLabel(locale, uiLocale)}
              </option>
            ))}
          </select>
          <ChevronDown className={styles.localeChevron} size={14} aria-hidden="true" />
        </div>
      </div>

      {saving && (
        <p className={styles.localeStatus} role="status">
          {getStaffShellText("localeSaving", uiLocale)}
        </p>
      )}
      {status === "saved" && (
        <p className={`${styles.localeStatus} ${styles.localeStatusSaved}`} role="status">
          {getStaffShellText("localeSaved", uiLocale)}
        </p>
      )}
      {status === "error" && errorMessage && (
        <p className={`${styles.localeStatus} ${styles.localeStatusError}`} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
