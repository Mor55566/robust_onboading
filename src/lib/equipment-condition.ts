import type { Locale } from "@/i18n/config";

export type EquipmentConditionId = "good" | "fair" | "poor" | "unknown";

export type EquipmentCondition = {
  id: EquipmentConditionId;
  en: string;
  he: string;
  ru: string;
};

export const EQUIPMENT_CONDITIONS: EquipmentCondition[] = [
  { id: "good", en: "Good", he: "טוב", ru: "Хорошее" },
  { id: "fair", en: "Fair", he: "סביר", ru: "Удовлетворительное" },
  { id: "poor", en: "Poor", he: "גרוע", ru: "Плохое" },
  { id: "unknown", en: "Unknown", he: "לא ידוע", ru: "Неизвестно" },
];

const conditionById = new Map(
  EQUIPMENT_CONDITIONS.map((condition) => [condition.id, condition]),
);

export function getEquipmentConditionLabel(
  condition: EquipmentCondition,
  locale: Locale | string,
): string {
  if (locale === "he") return condition.he;
  if (locale === "ru") return condition.ru;
  return condition.en;
}

export function resolveEquipmentConditionId(
  value: string | null | undefined,
): EquipmentConditionId | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  if (conditionById.has(raw as EquipmentConditionId)) {
    return raw as EquipmentConditionId;
  }

  const normalized = raw.toLowerCase();
  const match = EQUIPMENT_CONDITIONS.find(
    (condition) =>
      condition.en.toLowerCase() === normalized ||
      condition.he === raw ||
      condition.ru === raw,
  );
  return match?.id ?? null;
}
