export const locales = ["en", "he", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "he";
export const LOCALE_COOKIE = "locale";

export const localeIntlTags: Record<Locale, string> = {
  en: "en-US",
  he: "he-IL",
  ru: "ru-RU",
};

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function getLocaleIntlTag(locale: Locale): string {
  return localeIntlTags[locale];
}

export function getTextDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "he" ? "rtl" : "ltr";
}
