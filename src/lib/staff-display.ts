import { DEFAULT_LOCALE, type Locale } from "./locale";

export type LocalizedText = Readonly<Record<Locale, string>>;

export function getLocalizedText(
  text: LocalizedText,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return text[locale];
}

const SYSTEM_LOCATION_LABELS = {
  "倉庫": { ja: "倉庫", en: "Warehouse" },
  "自社": { ja: "自社", en: "In-house" },
  "不明": { ja: "不明", en: "Unknown" },
} satisfies Record<string, LocalizedText>;

export function getStaffLocationLabel(
  value: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const normalized = value?.trim();
  if (!normalized) return locale === "ja" ? "未設定" : "Not set";
  if (normalized in SYSTEM_LOCATION_LABELS) {
    return SYSTEM_LOCATION_LABELS[
      normalized as keyof typeof SYSTEM_LOCATION_LABELS
    ][locale];
  }
  return value!;
}

export function formatStaffTankCount(
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (locale === "ja") return `${count}本`;
  return `${new Intl.NumberFormat("en-US").format(count)} ${count === 1 ? "tank" : "tanks"}`;
}

export function getStaffTankUnit(
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (locale === "ja") return "本";
  return count === 1 ? "tank" : "tanks";
}

export function formatStaffItemCount(
  count: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (locale === "ja") return `${count}件`;
  return `${new Intl.NumberFormat("en-US").format(count)} ${count === 1 ? "item" : "items"}`;
}

export function formatStaffCount(
  count: number,
  locale: Locale,
  units: Readonly<{ ja: string; enSingular: string; enPlural: string }>,
): string {
  const formatted = new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US").format(count);
  if (locale === "ja") return `${formatted}${units.ja}`;
  return `${formatted} ${count === 1 ? units.enSingular : units.enPlural}`;
}

export function formatStaffDate(
  value: Date | number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: locale === "ja" ? "numeric" : "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(value);
}

export function formatStaffDateTime(
  value: Date | number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: locale === "ja" ? "numeric" : "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(value);
}

export function formatStaffShortDateTime(
  value: Date | number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(value);
}

export function formatStaffJpy(
  value: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * role code / 旧日本語 role 値の表示ラベル。
 * staff shell（menu）と mypage が同じ表記を使うため、共有 display boundary に置く。
 */
export const STAFF_ROLE_LABELS = {
  administrator: { ja: "管理者", en: "Administrator" },
  assistantAdministrator: { ja: "準管理者", en: "Assistant administrator" },
  staff: { ja: "一般", en: "Staff" },
  unknown: { ja: "不明", en: "Unknown role" },
} satisfies Record<string, LocalizedText>;

export function getStaffRoleDisplayLabel(
  value: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (locale === "ja") return value;
  if (value === "admin" || value === "管理者") return STAFF_ROLE_LABELS.administrator[locale];
  if (value === "準管理者") return STAFF_ROLE_LABELS.assistantAdministrator[locale];
  if (value === "worker" || value === "一般") return STAFF_ROLE_LABELS.staff[locale];
  return STAFF_ROLE_LABELS.unknown[locale];
}

const LOCALE_OPTION_LABELS: Readonly<Record<Locale, LocalizedText>> = {
  ja: { ja: "日本語", en: "Japanese" },
  en: { ja: "English", en: "English" },
};

/** 言語プルダウンの選択肢ラベル。value = 対象locale、uiLocale = 表示中のlocale */
export function getLocaleOptionLabel(
  value: Locale,
  uiLocale: Locale = DEFAULT_LOCALE,
): string {
  return LOCALE_OPTION_LABELS[value][uiLocale];
}

export function getStaffGenericErrorMessage(
  locale: Locale = DEFAULT_LOCALE,
): string {
  return locale === "ja"
    ? "操作を完了できませんでした。問題が続く場合は管理者に連絡してください。"
    : "The operation could not be completed. Contact an administrator if the problem persists.";
}
