import type { Locale } from "@/i18n/config";
import { getLocaleIntlTag } from "@/i18n/config";

export type EquipmentType = {
  id: string;
  en: string;
  he: string;
  ru: string;
};

/** Extra labels that map to a canonical type id. */
const EQUIPMENT_TYPE_ALIASES: Record<string, string> = {
  'יט"א': "air_handling_unit",
  יטא: "air_handling_unit",
  "Automated External Defibrillators": "automated_external_defibrillator",
};

export function getEquipmentTypeLabel(
  type: EquipmentType,
  locale: Locale | string,
): string {
  if (locale === "he") return type.he;
  if (locale === "ru") return type.ru;
  return type.en;
}

export function findEquipmentType(
  types: EquipmentType[],
  typeId: string | null | undefined,
): EquipmentType | null {
  if (!typeId) return null;
  return types.find((type) => type.id === typeId) ?? null;
}

export function resolveEquipmentTypeId(
  types: EquipmentType[],
  value: string | null | undefined,
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const byId = types.find((type) => type.id === raw);
  if (byId) return byId.id;

  const alias = EQUIPMENT_TYPE_ALIASES[raw];
  if (alias && types.some((type) => type.id === alias)) return alias;

  const normalized = raw.toLowerCase();
  const match = types.find(
    (type) =>
      type.en === raw ||
      type.he === raw ||
      type.ru === raw ||
      type.en.toLowerCase() === normalized,
  );
  return match?.id ?? null;
}

export function sortedEquipmentTypes(
  types: EquipmentType[],
  locale: Locale | string,
): EquipmentType[] {
  return [...types].sort((a, b) =>
    getEquipmentTypeLabel(a, locale).localeCompare(
      getEquipmentTypeLabel(b, locale),
      getLocaleIntlTag(locale as Locale),
    ),
  );
}
