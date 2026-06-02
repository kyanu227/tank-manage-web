import { DEFAULT_LOCALE, type Locale } from "./locale";
import { isReturnTag, type ReturnTag } from "./return-tag-rules";

export const RETURN_TAG_LABELS = {
  normal: {
    ja: "通常",
    en: "Normal",
  },
  unused: {
    ja: "未使用",
    en: "Unused",
  },
  uncharged: {
    ja: "未充填",
    en: "Uncharged",
  },
  keep: {
    ja: "持ち越し",
    en: "Carry over",
  },
} satisfies Record<ReturnTag, Record<Locale, string>>;

export function getReturnTagLabel(
  tag: ReturnTag,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return RETURN_TAG_LABELS[tag][locale];
}

export function getReturnTagLabelOrNull(
  tag: unknown,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return isReturnTag(tag) ? getReturnTagLabel(tag, locale) : null;
}
