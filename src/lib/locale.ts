export const SUPPORTED_LOCALES = ["ja", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ja";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string"
    && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const trimmed = value.trim();
  return isLocale(trimmed) ? trimmed : DEFAULT_LOCALE;
}
