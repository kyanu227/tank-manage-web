import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import {
  formatStaffCount,
  type LocalizedText,
} from "@/lib/staff-display";
import { formatDashboardLogLocation } from "@/features/staff-dashboard/i18n";

export const MYPAGE_TEXT = {
  staff: { ja: "スタッフ", en: "Staff member" },
  loading: { ja: "読み込み中…", en: "Loading…" },
  profileChecking: { ja: "プロフィール確認中…", en: "Checking profile…" },
  roleNotSet: { ja: "権限未設定", en: "Role not set" },
  rank: { ja: "ランク", en: "Rank" },
  regularRank: { ja: "レギュラー", en: "Regular" },
  rankNotSet: { ja: "ランク未設定", en: "Rank not set" },
  monthlyScore: { ja: "今月のスコア", en: "Monthly score" },
  estimatedReward: { ja: "報酬見込み", en: "Estimated reward" },
  displaySettings: { ja: "表示設定", en: "Display settings" },
  displaySettingsHelp: { ja: "このスタッフアカウントの表示言語を保存します。", en: "Save the display language for this staff account." },
  displayLanguage: { ja: "表示言語", en: "Display language" },
  saving: { ja: "保存中…", en: "Saving…" },
  save: { ja: "保存", en: "Save" },
  lend: { ja: "貸出", en: "Lend" },
  return: { ja: "返却", en: "Return" },
  fill: { ja: "充填", en: "Fill" },
  other: { ja: "その他", en: "Other" },
  recentWork: { ja: "最近の作業", en: "Recent work" },
  noLogs: { ja: "ログがありません", en: "No logs are available." },
  logsLoadFailure: { ja: "作業ログを読み込めませんでした。", en: "Work logs could not be loaded." },
  profileLoadFailure: { ja: "スタッフ情報を読み込めませんでした。", en: "Staff profile could not be loaded." },
  retry: { ja: "再試行", en: "Retry" },
  unknownAction: { ja: "不明", en: "Unknown action" },
  administrator: { ja: "管理者", en: "Administrator" },
  assistantAdministrator: { ja: "準管理者", en: "Assistant administrator" },
  staffRole: { ja: "一般", en: "Staff" },
  unknownRole: { ja: "不明", en: "Unknown role" },
} satisfies Record<string, LocalizedText>;

export type MyPageTextKey = keyof typeof MYPAGE_TEXT;

export function getMyPageText(key: MyPageTextKey, locale: Locale = DEFAULT_LOCALE): string {
  return MYPAGE_TEXT[key][locale];
}

const LOCALE_LABELS: Readonly<Record<Locale, Readonly<Record<Locale, string>>>> = {
  ja: { ja: "日本語", en: "Japanese" },
  en: { ja: "English", en: "English" },
};

export function getLocaleOptionLabel(value: Locale, uiLocale: Locale): string {
  return LOCALE_LABELS[value][uiLocale];
}

export function getStaffRoleDisplayLabel(value: string, locale: Locale): string {
  if (locale === "ja") return value;
  if (value === "admin" || value === "管理者") return getMyPageText("administrator", locale);
  if (value === "準管理者") return getMyPageText("assistantAdministrator", locale);
  if (value === "worker" || value === "一般") return getMyPageText("staffRole", locale);
  return getMyPageText("unknownRole", locale);
}

export function formatStaffProfileName(
  value: string,
  locale: Locale,
  generatedFallback: boolean,
): string {
  return generatedFallback ? getMyPageText("staff", locale) : value;
}

export function formatStaffProfileRank(
  value: string,
  locale: Locale,
  generatedFallback: boolean,
): string {
  return generatedFallback ? getMyPageText("regularRank", locale) : value;
}

export function formatProfileDescription(role: string, rank: string, locale: Locale): string {
  const roleLabel = role ? getStaffRoleDisplayLabel(role, locale) : getMyPageText("roleNotSet", locale);
  const rankLabel = rank ? `${getMyPageText("rank", locale)}: ${rank}` : getMyPageText("rankNotSet", locale);
  return `${roleLabel} / ${rankLabel}`;
}

export function formatRecentWorkTitle(limit: number, locale: Locale): string {
  if (locale === "ja") return `最近の作業 (直近${limit}件)`;
  const count = formatStaffCount(limit, locale, { ja: "件", enSingular: "entry", enPlural: "entries" });
  return `Recent work (latest ${count})`;
}

export function formatMyPageTime(date: Date, locale: Locale): string {
  if (locale === "ja") {
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatMyPageLocation(
  input: Readonly<{
    location: string;
    customerId?: string | null;
    customerName?: string | null;
    action?: string | null;
    transitionAction?: string | null;
  }>,
  locale: Locale,
): string {
  if (locale === "ja") return input.location;
  return formatDashboardLogLocation(input, locale);
}
