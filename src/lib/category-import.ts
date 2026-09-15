import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";

export const CATEGORY_IMPORT_HEADERS = [
  "categoryId",
  "name",
  "parent category id",
  "parent category name",
] as const;

export type CategoryImportRow = {
  rowNumber: number;
  externalId: string;
  name: string;
  parentExternalId: string;
  parentName: string;
};

const SAMPLE_ROWS: Omit<CategoryImportRow, "rowNumber">[] = [
  {
    externalId: "z9FvxMndrWFbY6Jtv",
    name: "אחזקת שבר",
    parentExternalId: "",
    parentName: "",
  },
  {
    externalId: "XBxiG9eZATeoaTBB8",
    name: "אינסטלציה",
    parentExternalId: "z9FvxMndrWFbY6Jtv",
    parentName: "אחזקת שבר",
  },
  {
    externalId: "XoRy4L4EHFZBATgqy",
    name: "תאורה",
    parentExternalId: "z9FvxMndrWFbY6Jtv",
    parentName: "אחזקת שבר",
  },
];

export function buildCategoriesCsvTemplate(): string {
  return buildCsvTemplate(
    [...CATEGORY_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) => [
      row.externalId,
      row.name,
      row.parentExternalId,
      row.parentName,
    ]),
  );
}

export function buildCategoriesExcelTemplate(): string {
  return buildExcelTemplate(
    "Categories",
    [...CATEGORY_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) => [
      { value: row.externalId, type: "String" },
      { value: row.name, type: "String" },
      { value: row.parentExternalId, type: "String" },
      { value: row.parentName, type: "String" },
    ]),
  );
}

export function parseCategoriesImportContent(
  content: string,
  fileName: string,
):
  | { rows: CategoryImportRow[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, [
    "categoryid",
    "category id",
    "category_id",
    "מזהה",
    "external id",
    "external_id",
  ]);
  const nameIndex = findHeaderIndex(header, ["name", "שם", "category name"]);
  const parentExternalIdIndex = findHeaderIndex(header, [
    "parent category id",
    "parent_category_id",
    "parent categoryid",
    "parent id",
    "מזהה קטגוריית אב",
  ]);
  const parentNameIndex = findHeaderIndex(header, [
    "parent category name",
    "parent_category_name",
    "parent name",
    "שם קטגוריית אב",
  ]);

  if (externalIdIndex < 0 || nameIndex < 0) return { error: "invalid" };

  const rows: CategoryImportRow[] = [];
  const seenExternalIds = new Set<string>();

  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const externalId = (cells[externalIdIndex] ?? "").trim();
    const name = (cells[nameIndex] ?? "").trim();
    if (!externalId || !name) {
      return {
        error: "invalidRow",
        message: `__row__:${rowNumber}`,
      };
    }
    if (seenExternalIds.has(externalId)) {
      return {
        error: "invalidRow",
        message: `__row__:${rowNumber}`,
      };
    }
    seenExternalIds.add(externalId);

    rows.push({
      rowNumber,
      externalId,
      name,
      parentExternalId:
        parentExternalIdIndex >= 0
          ? (cells[parentExternalIdIndex] ?? "").trim()
          : "",
      parentName:
        parentNameIndex >= 0 ? (cells[parentNameIndex] ?? "").trim() : "",
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

export type ExistingCategory = {
  id: string;
  name: string;
  external_id: string | null;
  parent_category_id: string | null;
};

export type CategoryImportPlanItem = {
  rowNumber: number;
  action: "create" | "update";
  id: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  parentName: string | null;
};

export type CategoryImportSkipped = {
  rowNumber: number;
  externalId: string;
  name: string;
  parentExternalId: string;
};

export function planCategoriesImport(options: {
  rows: CategoryImportRow[];
  existing: ExistingCategory[];
}): {
  ok: true;
  items: CategoryImportPlanItem[];
  skipped: CategoryImportSkipped[];
} {
  const byExternalId = new Map(
    options.existing
      .filter((category) => category.external_id)
      .map((category) => [category.external_id!, category]),
  );

  // Seed/manual rows often have a name but no external_id. Claim a unique
  // unmatched name so we update that row instead of inserting a duplicate.
  const unmatchedByName = new Map<string, ExistingCategory[]>();
  for (const category of options.existing) {
    if (category.external_id) continue;
    const key = category.name.trim().toLowerCase();
    const list = unmatchedByName.get(key) ?? [];
    list.push(category);
    unmatchedByName.set(key, list);
  }

  const claimedIds = new Set<string>();
  const knownParentIds = new Set(byExternalId.keys());
  const pending = [...options.rows];
  const items: CategoryImportPlanItem[] = [];
  const skipped: CategoryImportSkipped[] = [];

  // Accept roots first, then children whose parent is already known (DB or
  // already accepted from this file). Repeat until nothing else can resolve.
  let progressed = true;
  while (progressed && pending.length > 0) {
    progressed = false;
    for (let i = 0; i < pending.length; ) {
      const row = pending[i]!;
      const parentExternalId = row.parentExternalId.trim();
      const hasParent = parentExternalId.length > 0;

      if (hasParent && !knownParentIds.has(parentExternalId)) {
        i += 1;
        continue;
      }

      let existing = byExternalId.get(row.externalId) ?? null;
      if (!existing) {
        const key = row.name.trim().toLowerCase();
        const candidates = (unmatchedByName.get(key) ?? []).filter(
          (category) => !claimedIds.has(category.id),
        );
        if (candidates.length === 1) {
          existing = candidates[0]!;
          claimedIds.add(existing.id);
        }
      }

      const id = existing?.id ?? crypto.randomUUID();
      items.push({
        rowNumber: row.rowNumber,
        action: existing ? "update" : "create",
        id,
        externalId: row.externalId,
        name: row.name,
        parentExternalId: hasParent ? parentExternalId : null,
        parentName: row.parentName || null,
      });
      byExternalId.set(row.externalId, {
        id,
        name: row.name,
        external_id: row.externalId,
        parent_category_id: existing?.parent_category_id ?? null,
      });
      knownParentIds.add(row.externalId);
      pending.splice(i, 1);
      progressed = true;
    }
  }

  for (const row of pending) {
    skipped.push({
      rowNumber: row.rowNumber,
      externalId: row.externalId,
      name: row.name,
      parentExternalId: row.parentExternalId.trim(),
    });
  }

  return { ok: true, items, skipped };
}
