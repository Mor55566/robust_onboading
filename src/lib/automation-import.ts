import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";

export type AutomationImportRow = {
  rowNumber: number;
  sourceIndex: string;
  triggerType: "task_opened" | "task_not_completed_for" | "task_completed";
  priorities: Array<"low" | "medium" | "high" | "critical">;
  buildingNames: string[];
  categoryNames: string[];
  subcategoryNames: string[];
  actionType: "assign_users" | "notify_users" | "set_urgency";
  userNames: string[];
  actionUrgency: "low" | "medium" | "high" | "critical" | null;
  rulePreview: string;
  actionPreview: string;
  incompleteReason: string;
};

export type AutomationImportLookup = {
  buildings: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; parentId: string | null }>;
  users: Array<{ id: string; name: string }>;
};

export type ResolvedAutomationImportRow = AutomationImportRow & {
  name: string;
  buildingIds: string[];
  categoryIds: string[];
  subcategoryIds: string[];
  userIds: string[];
};

export type AutomationImportResolution =
  | { ok: true; rows: ResolvedAutomationImportRow[] }
  | { ok: false; rowNumber: number; message: string };

const HEADERS = [
  "index", "event", "trigger_type", "priorities", "buildings", "categories",
  "floors", "areas", "equipment", "action_type", "users", "rule_preview",
  "action_preview", "hidden_values", "needs_review",
] as const;

const SAMPLE = [
  "1", "נפתחת קריאה", "נפתחת קריאה", "כל עדיפות", "בניין A",
  "אחזקת שבר", "", "", "", "משתמשים משוייכים", "",
  "בניין A>אחזקת שבר>חשמל", "ישראל ישראלי", "", "no",
];

export function buildAutomationsCsvTemplate() {
  return buildCsvTemplate([...HEADERS], [SAMPLE]);
}

export function buildAutomationsExcelTemplate() {
  return buildExcelTemplate(
    "Automations",
    [...HEADERS],
    [SAMPLE.map((value) => ({ value, type: "String" as const }))],
  );
}

function splitPipe(value: string) {
  return unique(value.split("|").map(stripCount));
}

function splitComma(value: string) {
  return unique(value.split(/[|,;\n]/).map(stripCount));
}

function stripCount(value: string) {
  return value.replace(/\+\d+/g, "").replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isAll(value: string) {
  const normalized = normalize(value);
  return !normalized || normalized.startsWith("כל ") || normalized === "all";
}

function parseTrigger(value: string): AutomationImportRow["triggerType"] | null {
  const normalized = normalize(value);
  if (normalized.includes("נפתחת") || normalized === "task opened" || normalized === "task_opened") return "task_opened";
  if (normalized.includes("הושלמה") || normalized.includes("הושלם") || normalized === "task completed" || normalized === "task_completed") return "task_completed";
  if (normalized.includes("לא הושל") || normalized === "task_not_completed_for") return "task_not_completed_for";
  return null;
}

function parseAction(value: string): AutomationImportRow["actionType"] | null {
  const normalized = normalize(value);
  if (normalized.includes("משוייכ") || normalized.includes("משויכ") || normalized === "assign users" || normalized === "assign_users") return "assign_users";
  if (normalized.includes("יותרא") || normalized.includes("התרא") || normalized === "notify users" || normalized === "notify_users") return "notify_users";
  if (normalized.includes("דחיפות") || normalized === "set urgency" || normalized === "set_urgency") return "set_urgency";
  return null;
}

function parsePriorities(value: string): AutomationImportRow["priorities"] {
  if (isAll(value)) return [];
  const result: AutomationImportRow["priorities"] = [];
  for (const part of value.split(/[|,;]/)) {
    const normalized = normalize(part);
    if (normalized === "low" || normalized.includes("נמוכ")) result.push("low");
    else if (normalized === "medium" || normalized.includes("בינונ")) result.push("medium");
    else if (normalized === "high" || normalized.includes("גבוה")) result.push("high");
    else if (normalized === "critical" || normalized.includes("קריט")) result.push("critical");
  }
  return [...new Set(result)];
}

export function parseAutomationsImportContent(
  content: string,
  fileName: string,
): { rows: AutomationImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;
  const header = raw.rows[0]!.map(normalizeHeader);
  const indexOf = (name: string) => findHeaderIndex(header, [name]);
  const indexes = Object.fromEntries(HEADERS.map((name) => [name, indexOf(name)]));
  for (const required of ["trigger_type", "action_type", "rule_preview", "action_preview"]) {
    if (indexes[required] < 0) return { error: "invalid" };
  }

  const rows: AutomationImportRow[] = [];
  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;
    const get = (key: typeof HEADERS[number]) => indexes[key] >= 0 ? (cells[indexes[key]] ?? "").trim() : "";
    const triggerType = parseTrigger(get("trigger_type"));
    const actionType = parseAction(get("action_type"));
    if (!triggerType || !actionType || triggerType === "task_not_completed_for") {
      return { error: "invalidRow", message: `__row__:${i + 1}` };
    }

    const rulePreview = get("rule_preview");
    const hierarchy = rulePreview.split(">").map(stripCount);
    const modalBuildings = isAll(get("buildings")) ? [] : splitPipe(get("buildings"));
    const modalCategories = isAll(get("categories")) ? [] : splitPipe(get("categories"));
    const buildingNames = unique([
      ...modalBuildings,
      ...(hierarchy.length >= 2 ? splitComma(hierarchy[0] ?? "") : []),
    ]);
    const categoryNames = unique([
      ...modalCategories,
      ...(hierarchy.length >= 2 ? splitComma(hierarchy[1] ?? "") : []),
    ]).filter((name) => normalize(name) !== "אין קטגוריה");
    const subcategoryNames = hierarchy.length >= 3 ? splitComma(hierarchy.slice(2).join(">")) : [];
    const actionPreview = get("action_preview");
    const rawUsers = get("users");
    const userNames = actionType === "set_urgency"
      ? []
      : splitComma(normalize(rawUsers) === "בחר משתמש" ? actionPreview : rawUsers || actionPreview);
    const hidden = get("hidden_values");
    const needsReview = normalize(get("needs_review")) === "yes";
    const hasNoCategory = /אין קטגוריה/.test(get("categories")) || /אין קטגוריה/.test(rulePreview);
    const incompleteReason = [
      needsReview || hidden ? `חסרים ערכים מוסתרים (${hidden || "+N"})` : "",
      hasNoCategory ? "המסנן ‘אין קטגוריה’ אינו נתמך במבנה האוטומציות הנוכחי" : "",
    ].filter(Boolean).join("; ");

    rows.push({
      rowNumber: i + 1,
      sourceIndex: get("index") || String(i),
      triggerType,
      priorities: parsePriorities(get("priorities")),
      buildingNames,
      categoryNames,
      subcategoryNames,
      actionType,
      userNames,
      actionUrgency: null,
      rulePreview,
      actionPreview,
      incompleteReason,
    });
  }
  return rows.length ? { rows } : { error: "empty" };
}

function normalize(value: string) {
  return value.replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function resolveUnique<T extends { id: string; name: string }>(items: T[], name: string) {
  const matches = items.filter((item) => normalize(item.name) === normalize(name));
  return matches.length === 1 ? matches[0]! : null;
}

export function resolveAutomationImportRows(
  rows: AutomationImportRow[],
  lookup: AutomationImportLookup,
): AutomationImportResolution {
  const resolved: ResolvedAutomationImportRow[] = [];
  for (const row of rows) {
    if (row.incompleteReason) return { ok: false, rowNumber: row.rowNumber, message: row.incompleteReason };
    const buildingIds: string[] = [];
    for (const name of row.buildingNames) {
      const item = resolveUnique(lookup.buildings, name);
      if (!item) return { ok: false, rowNumber: row.rowNumber, message: `הבניין „${name}” לא נמצא או אינו חד־משמעי` };
      buildingIds.push(item.id);
    }
    const categoryIds: string[] = [];
    for (const name of row.categoryNames) {
      const item = resolveUnique(lookup.categories.filter((category) => !category.parentId), name);
      if (!item) return { ok: false, rowNumber: row.rowNumber, message: `הקטגוריה „${name}” לא נמצאה או אינה חד־משמעית` };
      categoryIds.push(item.id);
    }
    const subcategoryIds: string[] = [];
    for (const name of row.subcategoryNames) {
      const matches = lookup.categories.filter((category) =>
        category.parentId && categoryIds.includes(category.parentId) && normalize(category.name) === normalize(name));
      if (matches.length !== 1) return { ok: false, rowNumber: row.rowNumber, message: `תת־הקטגוריה „${name}” לא נמצאה תחת הקטגוריה שנבחרה` };
      subcategoryIds.push(matches[0]!.id);
    }
    const userIds: string[] = [];
    for (const name of row.userNames) {
      const item = resolveUnique(lookup.users, name);
      if (!item) return { ok: false, rowNumber: row.rowNumber, message: `המשתמש „${name}” לא נמצא או אינו חד־משמעי במתחם` };
      userIds.push(item.id);
    }
    if (row.actionType !== "set_urgency" && userIds.length === 0) {
      return { ok: false, rowNumber: row.rowNumber, message: "לא נמצאו משתמשים לפעולת האוטומציה" };
    }
    const description = `${row.rulePreview} ← ${row.actionPreview}`.replace(/\s+/g, " ").trim();
    resolved.push({
      ...row,
      name: `ייבוא #${row.sourceIndex}: ${description}`.slice(0, 120),
      buildingIds: unique(buildingIds),
      categoryIds: unique(categoryIds),
      subcategoryIds: unique(subcategoryIds),
      userIds: unique(userIds),
    });
  }
  return { ok: true, rows: resolved };
}
