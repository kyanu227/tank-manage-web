import type { Locale } from "@/lib/locale";
import {
  formatStaffCount,
  formatStaffTankCount,
} from "@/lib/staff-display";
import type {
  BulkReturnDatePool,
  BulkReturnGroupMeta,
  BulkTankDoc,
} from "./types";

type BulkReturnIdentitySource = Pick<BulkTankDoc, "customerName" | "location">;

const CUSTOMER_COUNT_UNITS = {
  ja: "顧客",
  enSingular: "customer",
  enPlural: "customers",
} as const;

const TAGGED_TANK_COUNT_UNITS = {
  ja: "本",
  enSingular: "tagged tank",
  enPlural: "tagged tanks",
} as const;

const GENERATED_UNKNOWN_CUSTOMER_LABEL = {
  ja: "不明な顧客",
  en: "Unknown customer",
} satisfies Record<Locale, string>;

const LEGACY_UNKNOWN_CUSTOMER_LABEL = {
  ja: "不明",
  en: "Unknown",
} satisfies Record<Locale, string>;

export function getGeneratedUnknownCustomerLabel(locale: Locale): string {
  return GENERATED_UNKNOWN_CUSTOMER_LABEL[locale];
}

export function getLegacyUnknownCustomerLabel(locale: Locale): string {
  return LEGACY_UNKNOWN_CUSTOMER_LABEL[locale];
}

const BULK_RETURN_POOL_LABELS = {
  today_lent: {
    ja: "本日貸出",
    en: "Rented today",
  },
  past_lent: {
    ja: "前日以前",
    en: "Earlier",
  },
  unknown_lent: {
    ja: "日付不明",
    en: "Unknown date",
  },
  long_term: {
    ja: "長期貸出",
    en: "Long-term",
  },
} satisfies Record<BulkReturnDatePool, Record<Locale, string>>;

const BULK_RETURN_DATE_TEXT = {
  today: {
    ja: "本日の貸出分",
    en: "Today's rentals",
  },
  pastUnknown: {
    ja: "前日以前の貸出中",
    en: "Earlier rental date",
  },
  unknown: {
    ja: "貸出日不明",
    en: "Rental date unknown",
  },
  unreturned: {
    ja: "未返却",
    en: "Unreturned",
  },
} satisfies Record<string, Record<Locale, string>>;

export function formatBulkReturnCustomerTankCount(
  customerCount: number,
  tankCount: number,
  locale: Locale,
): string {
  if (locale === "ja") return `${customerCount}顧客 / ${tankCount}本`;
  return [
    formatStaffCount(customerCount, locale, CUSTOMER_COUNT_UNITS),
    formatStaffTankCount(tankCount, locale),
  ].join(" / ");
}

export function formatBulkReturnTaggedTankCount(
  count: number,
  locale: Locale,
): string {
  if (locale === "ja") return `タグ${count}本`;
  return formatStaffCount(count, locale, TAGGED_TANK_COUNT_UNITS);
}

export function formatBulkReturnTankCountWithStatus(
  count: number,
  statusLabel: string,
  locale: Locale,
): string {
  return `${formatStaffTankCount(count, locale)} ${statusLabel}`;
}

export function formatBulkReturnHiddenCount(
  count: number,
  locale: Locale,
): string {
  if (locale === "ja") return `+${count}件`;
  return `+${new Intl.NumberFormat("en-US").format(count)} more`;
}

export function getBulkReturnDisplayLocation(
  location: string,
  meta: BulkReturnGroupMeta | undefined,
  locale: Locale,
  tanks: readonly BulkReturnIdentitySource[] = [],
): string {
  if (locale === "ja") return location;
  const isLegacyUnknown = meta?.key.endsWith("legacy-location:__unknown__") === true;
  const isGeneratedCustomerUnknown = meta?.customerId != null
    && location === GENERATED_UNKNOWN_CUSTOMER_LABEL.ja
    && tanks.length > 0
    && tanks.every((tank) => (
      !tank.customerName?.trim()
      && !tank.location?.trim()
    ));
  if (isLegacyUnknown || isGeneratedCustomerUnknown) {
    return GENERATED_UNKNOWN_CUSTOMER_LABEL.en;
  }
  return location;
}

export function getBulkReturnPoolLabel(
  meta: BulkReturnGroupMeta,
  locale: Locale,
): string {
  if (locale === "ja") return meta.poolLabel;
  return BULK_RETURN_POOL_LABELS[meta.pool][locale];
}

export function getBulkReturnDateLabel(
  meta: BulkReturnGroupMeta,
  locale: Locale,
): string {
  if (locale === "ja") return meta.dateLabel;

  if (meta.pool === "today_lent") return BULK_RETURN_DATE_TEXT.today[locale];
  if (meta.pool === "unknown_lent") return BULK_RETURN_DATE_TEXT.unknown[locale];
  if (!Number.isFinite(meta.sortMillis)) {
    return meta.pool === "long_term"
      ? BULK_RETURN_DATE_TEXT.unreturned[locale]
      : BULK_RETURN_DATE_TEXT.pastUnknown[locale];
  }

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(meta.sortMillis!));

  return meta.pool === "long_term"
    ? `Unreturned since ${dateLabel}`
    : `On or before ${dateLabel}`;
}

export function getBulkReturnGroupDisplayLabel(
  rawLocation: string,
  meta: BulkReturnGroupMeta | undefined,
  locale: Locale,
  tanks: readonly BulkReturnIdentitySource[] = [],
): string {
  const location = getBulkReturnDisplayLocation(rawLocation, meta, locale, tanks);
  if (!meta) return location;
  const poolLabel = getBulkReturnPoolLabel(meta, locale);
  return locale === "ja"
    ? `${location}（${poolLabel}）`
    : `${location} (${poolLabel})`;
}
