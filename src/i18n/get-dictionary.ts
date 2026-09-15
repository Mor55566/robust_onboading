import { cookies } from "next/headers";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/i18n/config";
import { en, type Dictionary } from "@/i18n/dictionaries/en";
import { he } from "@/i18n/dictionaries/he";
import { ru } from "@/i18n/dictionaries/ru";

const dictionaries: Record<Locale, Dictionary> = { en, he, ru };

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  if (value && isLocale(value)) return value;
  return defaultLocale;
}

export async function getDictionary(): Promise<Dictionary> {
  const locale = await getLocale();
  return dictionaries[locale];
}

export { t } from "@/i18n/t";
