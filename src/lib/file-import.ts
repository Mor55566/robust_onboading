import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";
import { normalizeLookup } from "@/lib/task-import";

const DEFAULT_TAG_COLOR = "#3b82f6";

export const FILE_TAG_IMPORT_HEADERS = ["שם התגית", "צבע"] as const;

export const FILE_IMPORT_HEADERS = ["#", "מזהה", "נכס", "שם", "תגית", "שייך מסמך ל"] as const;

export type FileTagImportRow = {
  rowNumber: number;
  name: string;
  color: string;
};

export type FileImportRow = {
  rowNumber: number;
  externalId: string;
  title: string;
  complex: string;
  tag: string;
  resident: string;
};

export type ImportComplex = { id: string; name: string };

export function normalizeImportedResidentName(value: string): string {
  const withoutPrefix = value
    .trim()
    .replace(/^(?:דייר|resident)\s*[-–—:]\s*/i, "")
    .trim();
  const bracketed = withoutPrefix.match(/^\[(.+)]$/);
  return (bracketed?.[1] ?? withoutPrefix).trim();
}

export function isArchivedImportedResident(value: string): boolean {
  return /\(\s*בארכיון\s*\)\s*$/.test(value.trim());
}

export function isUnlinkedImportedResident(value: string): boolean {
  const normalized = normalizeLookup(value);
  return (
    normalized === "אין ישויות מקושרות" ||
    normalized === "no linked entities"
  );
}

function resolveImportedResidentId(
  value: string,
  residents: { id: string; display_name: string }[],
):
  | { ok: true; id: string | null }
  | { ok: false; value: string } {
  const trimmed = value.trim();
  if (
    !trimmed ||
    isArchivedImportedResident(trimmed) ||
    isUnlinkedImportedResident(trimmed)
  ) {
    return { ok: true, id: null };
  }

  const importedName = normalizeImportedResidentName(trimmed);
  const matches = residents.filter(
    (resident) =>
      normalizeLookup(resident.display_name) === normalizeLookup(importedName),
  );
  if (matches.length !== 1) {
    return { ok: false, value: trimmed };
  }
  return { ok: true, id: matches[0]!.id };
}

export function normalizeImportedUserName(value: string): string {
  return value.replace(/\([^)]*\)/g, "").trim();
}

const TAG_SAMPLE_ROWS: Omit<FileTagImportRow, "rowNumber">[] = [
  {
    name: "חוזים",
    color: "#3b82f6",
  },
  {
    name: "ביטוח",
    color: "#7c3aed",
  },
];

const FILE_SAMPLE_ROWS: Omit<FileImportRow, "rowNumber">[] = [
  {
    externalId: "63a7f43add488d6b2c254069",
    title: "תעודת בדיקה למערכת CO",
    complex: "TOU Towers",
    tag: "חוזים",
    resident: "דייר - מנדיי",
  },
];

export function buildFileTagsCsvTemplate(): string {
  return buildCsvTemplate(
    [...FILE_TAG_IMPORT_HEADERS],
    TAG_SAMPLE_ROWS.map((row) => [row.name, row.color]),
  );
}

export function buildFileTagsExcelTemplate(): string {
  return buildExcelTemplate(
    "File tags",
    [...FILE_TAG_IMPORT_HEADERS],
    TAG_SAMPLE_ROWS.map((row) => [
      { value: row.name, type: "String" },
      { value: row.color, type: "String" },
    ]),
  );
}

export function buildFilesCsvTemplate(): string {
  return buildCsvTemplate(
    [...FILE_IMPORT_HEADERS],
    FILE_SAMPLE_ROWS.map((row, index) => [
      String(index + 1),
      row.externalId,
      row.complex,
      row.title,
      row.tag,
      row.resident,
    ]),
  );
}

export function buildFilesExcelTemplate(): string {
  return buildExcelTemplate(
    "Files",
    [...FILE_IMPORT_HEADERS],
    FILE_SAMPLE_ROWS.map((row, index) => [
      { value: String(index + 1), type: "String" },
      { value: row.externalId, type: "String" },
      { value: row.complex, type: "String" },
      { value: row.title, type: "String" },
      { value: row.tag, type: "String" },
      { value: row.resident, type: "String" },
    ]),
  );
}

function normalizeTagColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed;
  return DEFAULT_TAG_COLOR;
}

function resolveComplexByName(
  value: string,
  complexes: ImportComplex[],
  complexByName: Map<string, ImportComplex>,
): ImportComplex | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = complexByName.get(normalizeLookup(trimmed));
  if (direct) return direct;

  for (const complex of complexes) {
    const name = normalizeLookup(complex.name);
    if (
      name === normalizeLookup(trimmed) ||
      name.endsWith(` ${normalizeLookup(trimmed)}`)
    ) {
      return complex;
    }
  }

  return null;
}

export function parseFileTagsImportContent(
  content: string,
  fileName: string,
):
  | { rows: FileTagImportRow[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const nameIndex = findHeaderIndex(header, [
    "name",
    "שם",
    "tag name",
    "שם התגית",
    "שם תגית",
  ]);
  const colorIndex = findHeaderIndex(header, ["color", "צבע"]);

  if (nameIndex < 0) {
    return { error: "invalid" };
  }

  const rows: FileTagImportRow[] = [];
  const seenNames = new Set<string>();

  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const name = (cells[nameIndex] ?? "").trim();
    if (!name) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }
    const nameKey = normalizeLookup(name);
    if (seenNames.has(nameKey)) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }
    seenNames.add(nameKey);

    rows.push({
      rowNumber,
      name,
      color:
        colorIndex >= 0
          ? normalizeTagColor(cells[colorIndex] ?? "")
          : DEFAULT_TAG_COLOR,
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

export function parseFilesImportContent(
  content: string,
  fileName: string,
):
  | { rows: FileImportRow[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, [
    "fileid",
    "file id",
    "file_id",
    "מזהה",
    "external id",
    "external_id",
  ]);
  const titleIndex = findHeaderIndex(header, ["title", "שם", "כותרת"]);
  const complexIndex = findHeaderIndex(header, [
    "complex",
    "מתחם",
    "נכס",
    "property",
    "asset",
  ]);
  const tagIndex = findHeaderIndex(header, [
    "tag name",
    "tag_name",
    "tag",
    "תגית",
    "תגיות",
  ]);
  const residentIndex = findHeaderIndex(header, [
    "linked entity",
    "linked_entity",
    "resident",
    "דייר",
    "שייך מסמך ל",
  ]);

  if (externalIdIndex < 0 || titleIndex < 0 || complexIndex < 0) {
    return { error: "invalid" };
  }

  const rows: FileImportRow[] = [];
  const seenExternalIds = new Set<string>();

  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const externalId = (cells[externalIdIndex] ?? "").trim();
    const title = (cells[titleIndex] ?? "").trim();
    const complex = (cells[complexIndex] ?? "").trim();
    const tag = tagIndex >= 0 ? (cells[tagIndex] ?? "").trim() : "";
    const resident =
      residentIndex >= 0 ? (cells[residentIndex] ?? "").trim() : "";
    if (!externalId || !title || !complex) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }
    if (seenExternalIds.has(externalId)) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }
    seenExternalIds.add(externalId);

    rows.push({
      rowNumber,
      externalId,
      title,
      complex,
      tag,
      resident,
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

export type ExistingFileTag = {
  id: string;
  complex_id: string;
  name: string;
};

export type FileTagImportPlanItem = {
  rowNumber: number;
  action: "create" | "update";
  id: string;
  complexId: string;
  name: string;
  color: string;
};

export function planFileTagsImport(options: {
  rows: FileTagImportRow[];
  complexId: string;
  existing: ExistingFileTag[];
}): {
  ok: true;
  items: FileTagImportPlanItem[];
} {
  const byName = new Map<string, ExistingFileTag>();
  for (const tag of options.existing) {
    if (tag.complex_id !== options.complexId) continue;
    byName.set(normalizeLookup(tag.name), tag);
  }

  const items: FileTagImportPlanItem[] = [];

  for (const row of options.rows) {
    const existing = byName.get(normalizeLookup(row.name)) ?? null;
    const id = existing?.id ?? crypto.randomUUID();
    items.push({
      rowNumber: row.rowNumber,
      action: existing ? "update" : "create",
      id,
      complexId: options.complexId,
      name: row.name,
      color: row.color,
    });

    byName.set(normalizeLookup(row.name), {
      id,
      complex_id: options.complexId,
      name: row.name,
    });
  }

  return { ok: true, items };
}

export type ExistingFileSeries = {
  id: string;
  complex_id: string;
  title: string | null;
  external_id: string | null;
};

export type ResolvedFileImportRow = {
  rowNumber: number;
  action: "create" | "update";
  id: string;
  externalId: string;
  complexId: string;
  title: string;
  tagId: string | null;
  residentId: string | null;
};

function fileSeriesExternalKey(complexId: string, externalId: string) {
  return `${complexId}:${externalId}`;
}

function fileSeriesTitleKey(complexId: string, title: string) {
  return `${complexId}:${normalizeLookup(title)}`;
}

export function resolveFileImportRows(options: {
  rows: FileImportRow[];
  complexes: ImportComplex[];
  existing: ExistingFileSeries[];
  tags?: ExistingFileTag[];
  residents?: { id: string; complex_id: string; display_name: string }[];
}):
  | { ok: true; items: ResolvedFileImportRow[] }
  | {
      ok: false;
      rowNumber: number;
      code: "complex" | "tag" | "resident";
      value: string;
    } {
  const complexByName = new Map(
    options.complexes.map((complex) => [
      normalizeLookup(complex.name),
      complex,
    ]),
  );
  const byExternalId = new Map<string, ExistingFileSeries>();
  const unmatchedByTitle = new Map<string, ExistingFileSeries[]>();
  for (const series of options.existing) {
    const externalId = series.external_id?.trim() ?? "";
    if (externalId) {
      byExternalId.set(
        fileSeriesExternalKey(series.complex_id, externalId),
        series,
      );
      continue;
    }
    if (!series.title) continue;
    const titleKey = fileSeriesTitleKey(series.complex_id, series.title);
    const list = unmatchedByTitle.get(titleKey) ?? [];
    list.push(series);
    unmatchedByTitle.set(titleKey, list);
  }

  const claimedSeriesIds = new Set<string>();
  const tagsByComplexAndName = new Map<string, ExistingFileTag>();
  for (const tag of options.tags ?? []) {
    tagsByComplexAndName.set(
      `${tag.complex_id}:${normalizeLookup(tag.name)}`,
      tag,
    );
  }
  const items: ResolvedFileImportRow[] = [];

  for (const row of options.rows) {
    const complex = resolveComplexByName(
      row.complex,
      options.complexes,
      complexByName,
    );
    if (!complex) {
      return { ok: false, rowNumber: row.rowNumber, code: "complex", value: row.complex };
    }

    let tagId: string | null = null;
    if (row.tag.trim()) {
      const tag =
        tagsByComplexAndName.get(
          `${complex.id}:${normalizeLookup(row.tag)}`,
        ) ?? null;
      if (!tag) {
        return {
          ok: false,
          rowNumber: row.rowNumber,
          code: "tag",
          value: row.tag,
        };
      }
      tagId = tag.id;
    }

    const residentsInComplex = (options.residents ?? []).filter(
      (resident) => resident.complex_id === complex.id,
    );
    const resolvedResident = resolveImportedResidentId(
      row.resident,
      residentsInComplex,
    );
    if (!resolvedResident.ok) {
      return {
        ok: false,
        rowNumber: row.rowNumber,
        code: "resident",
        value: resolvedResident.value,
      };
    }

    let existing =
      byExternalId.get(fileSeriesExternalKey(complex.id, row.externalId)) ??
      null;
    if (!existing) {
      const titleKey = fileSeriesTitleKey(complex.id, row.title);
      const candidates = (unmatchedByTitle.get(titleKey) ?? []).filter(
        (series) => !claimedSeriesIds.has(series.id),
      );
      if (candidates.length === 1) {
        existing = candidates[0]!;
        claimedSeriesIds.add(existing.id);
      }
    }

    const seriesId = existing?.id ?? crypto.randomUUID();

    items.push({
      rowNumber: row.rowNumber,
      action: existing ? "update" : "create",
      id: seriesId,
      externalId: row.externalId,
      complexId: complex.id,
      title: row.title,
      tagId,
      residentId: resolvedResident.id,
    });
  }

  return { ok: true, items };
}

export const FILE_ATTACHMENT_IMPORT_HEADERS = [
  "external_id",
  "title",
  "tag_name",
  "linked_entity",
  "version",
  "source",
  "start_date",
  "expiration_date",
  "created_at",
  "created_by_name",
  "attachment_index",
  "file_name",
  "mime_type",
  "storage_url",
] as const;

export type FileAttachmentImportImage = {
  index: number;
  fileName: string;
  mimeType: string;
  storageUrl: string;
  externalId: string | null;
};

export type FileAttachmentImportDocument = {
  rowNumber: number;
  externalId: string;
  tag: string;
  resident: string;
  version: number;
  startDate: string | null;
  expirationDate: string | null;
  createdAt: string | null;
  createdByName: string;
  attachments: FileAttachmentImportImage[];
};

const ATTACHMENT_SAMPLE_ROWS: Omit<FileAttachmentImportDocument, "rowNumber">[] =
  [
    {
      externalId: "655dbe604d69d1fff0721cdd",
      tag: "דיירים - אחזקה מונעת",
      resident: "דייר - אנבידיה",
      version: 1,
      startDate: "1/5/22",
      expirationDate: "30/4/27",
      createdAt: "22/11/23 10:40",
      createdByName: "ישראל ישראלי",
      attachments: [
        {
          index: 1,
          fileName: "tuejkh7aabxfbt0ngkiq.jpeg",
          mimeType: "image/jpeg",
          storageUrl:
            "https://res.cloudinary.com/gantzi/image/upload/tuejkh7aabxfbt0ngkiq.jpeg",
          externalId: "tuejkh7aabxfbt0ngkiq",
        },
      ],
    },
  ];

export function buildFileAttachmentsCsvTemplate(): string {
  return buildCsvTemplate(
    [...FILE_ATTACHMENT_IMPORT_HEADERS],
    ATTACHMENT_SAMPLE_ROWS.flatMap((row) =>
      row.attachments.map((attachment) => [
        row.externalId,
        "",
        row.tag,
        row.resident,
        String(row.version),
        "current",
        row.startDate ?? "",
        row.expirationDate ?? "",
        row.createdAt ?? "",
        row.createdByName,
        String(attachment.index),
        attachment.fileName,
        attachment.mimeType,
        attachment.storageUrl,
      ]),
    ),
  );
}

export function buildFileAttachmentsExcelTemplate(): string {
  return buildExcelTemplate(
    "Document files",
    [...FILE_ATTACHMENT_IMPORT_HEADERS],
    ATTACHMENT_SAMPLE_ROWS.flatMap((row) =>
      row.attachments.map((attachment) =>
        [
          row.externalId,
          "",
          row.tag,
          row.resident,
          String(row.version),
          "current",
          row.startDate ?? "",
          row.expirationDate ?? "",
          row.createdAt ?? "",
          row.createdByName,
          String(attachment.index),
          attachment.fileName,
          attachment.mimeType,
          attachment.storageUrl,
        ].map((value) => ({ value, type: "String" as const })),
      ),
    ),
  );
}

function parseExportDateOnly(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
  if (!slash) return null;

  const day = Number(slash[1]);
  const month = Number(slash[2]);
  let year = Number(slash[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseExportDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) {
    const dateOnly = parseExportDateOnly(trimmed);
    return dateOnly ? `${dateOnly}T00:00:00+03:00` : null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
}

function parsePositiveInt(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  return Number.parseInt(trimmed, 10);
}

export function isCloudinaryStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return /(^|\.)cloudinary\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function attachmentPathname(storageUrl: string): string {
  const rawUrl = storageUrl.trim().toLowerCase();
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return rawUrl;
  }
}

function isCsvAttachment(options: {
  mimeType: string;
  fileName: string;
  storageUrl: string;
}): boolean {
  const mime = options.mimeType.trim().toLowerCase();
  const fileName = options.fileName.trim().toLowerCase();
  const pathname = attachmentPathname(options.storageUrl);
  return (
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime.includes("csv") ||
    fileName.endsWith(".csv") ||
    pathname.endsWith(".csv")
  );
}

export const FILE_ATTACHMENT_NOT_CLOUDINARY_PREFIX = "__notCloudinary__:";

export function fileAttachmentNotCloudinaryMessage(
  rowNumber: number,
  url: string,
): string {
  return `${FILE_ATTACHMENT_NOT_CLOUDINARY_PREFIX}${rowNumber}:${url}`;
}

export function parseFileAttachmentNotCloudinaryMessage(
  message: string | undefined,
): { row: string; url: string } | null {
  if (!message?.startsWith(FILE_ATTACHMENT_NOT_CLOUDINARY_PREFIX)) return null;
  const rest = message.slice(FILE_ATTACHMENT_NOT_CLOUDINARY_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  return { row: rest.slice(0, sep), url: rest.slice(sep + 1) };
}

export function isCopyableImageAttachment(options: {
  mimeType: string;
  fileName: string;
  storageUrl: string;
}): boolean {
  const mime = options.mimeType.trim().toLowerCase();
  const fileName = options.fileName.trim().toLowerCase();
  const rawUrl = options.storageUrl.trim();
  if (!/^https?:\/\//i.test(rawUrl)) return false;
  if (!isCloudinaryStorageUrl(rawUrl)) return false;
  if (isCsvAttachment(options)) return false;

  const pathname = attachmentPathname(rawUrl);
  if (mime.startsWith("image/")) return true;
  return (
    /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif|tiff)$/i.test(fileName) ||
    /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif|tiff)$/i.test(pathname)
  );
}

export function cloudinaryPublicIdFromSource(
  storageUrl: string,
  fileName = "",
): string | null {
  try {
    const { pathname } = new URL(storageUrl);
    const match = pathname.match(/\/(?:image|video|raw)\/upload\/(.+)$/i);
    if (match) {
      let rest = decodeURIComponent(match[1]!.split("?")[0] ?? "");
      const versionMatch = rest.match(/(?:^|\/)v\d+\/(.+)$/);
      if (versionMatch) rest = versionMatch[1]!;
      const segments = rest.split("/").filter(Boolean);
      const withoutTransforms = segments.filter(
        (segment) => !/^[a-z]+_[^,]+(?:,[a-z]+_[^,]+)*$/i.test(segment),
      );
      const last = (withoutTransforms.at(-1) ?? segments.at(-1) ?? "").trim();
      const publicId = last.replace(/\.[^/.]+$/, "").trim();
      if (publicId) return publicId;
    }
  } catch {
    // Fall back to the file name when the URL is not absolute.
  }

  const base = fileName.trim().split(/[\\/]/).pop() ?? "";
  const fromName = base.replace(/\.[^/.]+$/, "").trim();
  return fromName || null;
}

function documentKey(externalId: string, version: number) {
  return `${externalId}:${version}`;
}

export function parseFileAttachmentsImportContent(
  content: string,
  fileName: string,
):
  | { rows: FileAttachmentImportDocument[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, [
    "external id",
    "external_id",
    "מזהה חיצוני",
  ]);
  const storageUrlIndex = findHeaderIndex(header, [
    "storage url",
    "storage_url",
    "url",
  ]);
  const tagIndex = findHeaderIndex(header, [
    "tag name",
    "tag_name",
    "tag",
    "תגית",
    "תגיות",
  ]);
  const residentIndex = findHeaderIndex(header, [
    "linked entity",
    "linked_entity",
    "resident",
    "דייר",
    "שייך מסמך ל",
  ]);
  const versionIndex = findHeaderIndex(header, ["version", "גרסה"]);
  const startDateIndex = findHeaderIndex(header, [
    "start date",
    "start_date",
    "תאריך התחלה",
  ]);
  const expirationDateIndex = findHeaderIndex(header, [
    "expiration date",
    "expiration_date",
    "תאריך תפוגה",
    "תאריך סיום",
    "end date",
    "end_date",
  ]);
  const createdAtIndex = findHeaderIndex(header, [
    "created at",
    "created_at",
    "תאריך יצירה",
  ]);
  const createdByNameIndex = findHeaderIndex(header, [
    "created by name",
    "created_by_name",
    "created by",
    "created_by",
    "יוצר",
    "נוצר על ידי",
  ]);
  const attachmentIndexIndex = findHeaderIndex(header, [
    "attachment index",
    "attachment_index",
  ]);
  const fileNameIndex = findHeaderIndex(header, [
    "file name",
    "file_name",
    "filename",
  ]);
  const mimeTypeIndex = findHeaderIndex(header, [
    "mime type",
    "mime_type",
    "content type",
  ]);

  if (externalIdIndex < 0 || storageUrlIndex < 0) {
    return { error: "invalid" };
  }

  const grouped = new Map<string, FileAttachmentImportDocument>();
  const order: string[] = [];

  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const externalId = (cells[externalIdIndex] ?? "").trim();
    if (!externalId) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }

    const version =
      versionIndex >= 0 ? parsePositiveInt(cells[versionIndex] ?? "", 1) : 1;
    const key = documentKey(externalId, version);
    let document = grouped.get(key);
    if (!document) {
      const hasExpiration =
        (startDateIndex >= 0 &&
          (cells[startDateIndex] ?? "").trim().length > 0) ||
        (expirationDateIndex >= 0 &&
          (cells[expirationDateIndex] ?? "").trim().length > 0);
      document = {
        rowNumber,
        externalId,
        tag: tagIndex >= 0 ? (cells[tagIndex] ?? "").trim() : "",
        resident: residentIndex >= 0 ? (cells[residentIndex] ?? "").trim() : "",
        version,
        startDate:
          hasExpiration && startDateIndex >= 0
            ? parseExportDateOnly(cells[startDateIndex] ?? "")
            : null,
        expirationDate:
          hasExpiration && expirationDateIndex >= 0
            ? parseExportDateOnly(cells[expirationDateIndex] ?? "")
            : null,
        createdAt:
          createdAtIndex >= 0
            ? parseExportDateTime(cells[createdAtIndex] ?? "")
            : null,
        createdByName:
          createdByNameIndex >= 0
            ? (cells[createdByNameIndex] ?? "").trim()
            : "",
        attachments: [],
      };
      grouped.set(key, document);
      order.push(key);
    }

    const storageUrl = (cells[storageUrlIndex] ?? "").trim();
    const attachmentFileName =
      fileNameIndex >= 0 ? (cells[fileNameIndex] ?? "").trim() : "";
    const mimeType =
      mimeTypeIndex >= 0 ? (cells[mimeTypeIndex] ?? "").trim() : "";
    const attachment = {
      mimeType,
      fileName: attachmentFileName,
      storageUrl,
    };
    if (storageUrl && !isCsvAttachment(attachment) && !isCloudinaryStorageUrl(storageUrl)) {
      return {
        error: "invalidRow",
        message: fileAttachmentNotCloudinaryMessage(rowNumber, storageUrl),
      };
    }
    if (isCopyableImageAttachment(attachment)) {
      document.attachments.push({
        index:
          attachmentIndexIndex >= 0
            ? parsePositiveInt(cells[attachmentIndexIndex] ?? "", 0)
            : document.attachments.length + 1,
        fileName: attachmentFileName || storageUrl,
        mimeType: mimeType || "image/jpeg",
        storageUrl,
        externalId: cloudinaryPublicIdFromSource(storageUrl, attachmentFileName),
      });
    }
  }

  if (order.length === 0) return { error: "empty" };

  return {
    rows: order.map((key) => {
      const document = grouped.get(key)!;
      document.attachments.sort((a, b) => a.index - b.index);
      return document;
    }),
  };
}

export type ExistingFileSeriesForAttachment = {
  id: string;
  title: string;
  external_id: string | null;
};

export type ExistingFileVersion = {
  id: string;
  series_id: string;
  version: number;
  file_external_id?: string | null;
};

export type ExistingImportedAttachment = {
  series_id: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  storage_url: string;
  external_id: string | null;
};

export type ResolvedImportAttachment = FileAttachmentImportImage & {
  alreadyOnFile: boolean;
  reuse: {
    file_name: string;
    mime_type: string;
    storage_url: string;
  } | null;
};

export type ResolvedFileAttachmentImportRow = {
  rowNumber: number;
  action: "create" | "update";
  seriesAction: "create" | "reuse";
  id: string;
  seriesId: string;
  externalId: string;
  complexId: string;
  version: number;
  title: string;
  tagId: string | null;
  residentId: string | null;
  startDate: string | null;
  expirationDate: string | null;
  createdAt: string | null;
  createdByUserId: string | null;
  fileExternalId: string | null;
  attachments: ResolvedImportAttachment[];
};

export function resolveFileAttachmentImportRows(options: {
  rows: FileAttachmentImportDocument[];
  complexId: string;
  existingSeries: ExistingFileSeriesForAttachment[];
  existingVersions: ExistingFileVersion[];
  existingAttachments?: ExistingImportedAttachment[];
  tags: ExistingFileTag[];
  residents: { id: string; complex_id: string; display_name: string }[];
  users: { id: string; complex_id: string; full_name: string }[];
}):
  | { ok: true; items: ResolvedFileAttachmentImportRow[] }
  | {
      ok: false;
      rowNumber: number;
      code: "tag" | "resident" | "user" | "series";
      value: string;
    } {
  const seriesById = new Map<
    string,
    { title: string; versions: Map<number, ExistingFileVersion> }
  >();
  const seriesByExternalId = new Map<string, string>();
  for (const series of options.existingSeries) {
    seriesById.set(series.id, {
      title: series.title,
      versions: new Map<number, ExistingFileVersion>(),
    });
    const externalId = series.external_id?.trim() ?? "";
    if (externalId && !seriesByExternalId.has(externalId)) {
      seriesByExternalId.set(externalId, series.id);
    }
  }
  for (const version of options.existingVersions) {
    seriesById.get(version.series_id)?.versions.set(version.version, version);
  }

  const attachmentsBySeries = new Map<string, ExistingImportedAttachment[]>();
  for (const attachment of options.existingAttachments ?? []) {
    const list = attachmentsBySeries.get(attachment.series_id) ?? [];
    list.push(attachment);
    attachmentsBySeries.set(attachment.series_id, list);
  }

  const tagsByName = new Map<string, ExistingFileTag>();
  for (const tag of options.tags) {
    if (tag.complex_id !== options.complexId) continue;
    tagsByName.set(normalizeLookup(tag.name), tag);
  }
  const residents = options.residents.filter(
    (resident) => resident.complex_id === options.complexId,
  );
  const users = options.users.filter(
    (user) => user.complex_id === options.complexId,
  );

  const items: ResolvedFileAttachmentImportRow[] = [];

  for (const row of options.rows) {
    let tagId: string | null = null;
    if (row.tag.trim()) {
      tagId = tagsByName.get(normalizeLookup(row.tag))?.id ?? null;
    }

    const resolvedResident = resolveImportedResidentId(row.resident, residents);
    if (!resolvedResident.ok) {
      return {
        ok: false,
        rowNumber: row.rowNumber,
        code: "resident",
        value: resolvedResident.value,
      };
    }
    const residentId = resolvedResident.id;

    let createdByUserId: string | null = null;
    if (row.createdByName.trim()) {
      const importedUserName = normalizeImportedUserName(row.createdByName);
      const matches = users.filter(
        (user) =>
          normalizeLookup(user.full_name) === normalizeLookup(importedUserName) ||
          normalizeLookup(user.full_name) ===
            normalizeLookup(row.createdByName),
      );
      const uniqueMatches = [
        ...new Map(matches.map((user) => [user.id, user])).values(),
      ];
      if (uniqueMatches.length !== 1) {
        return {
          ok: false,
          rowNumber: row.rowNumber,
          code: "user",
          value: row.createdByName,
        };
      }
      createdByUserId = uniqueMatches[0]!.id;
    }

    const incomingAttachments = row.attachments.map((attachment) => ({
      ...attachment,
      externalId:
        attachment.externalId ??
        cloudinaryPublicIdFromSource(attachment.storageUrl, attachment.fileName),
    }));

    const seriesId = seriesByExternalId.get(row.externalId.trim()) ?? null;
    if (!seriesId) {
      return {
        ok: false,
        rowNumber: row.rowNumber,
        code: "series",
        value: row.externalId,
      };
    }

    const existingSeries = seriesById.get(seriesId) ?? null;
    const existingVersion = existingSeries?.versions.get(row.version) ?? null;
    const existingSeriesFiles = existingSeries
      ? [...existingSeries.versions.values()]
      : [];
    const fileId = existingVersion?.id ?? crypto.randomUUID();

    existingSeries?.versions.set(row.version, {
      id: fileId,
      series_id: seriesId,
      version: row.version,
      file_external_id: incomingAttachments[0]?.externalId ?? null,
    });

    const seriesAttachments = attachmentsBySeries.get(seriesId) ?? [];
    const storedByExternalId = new Map<string, ExistingImportedAttachment>();
    const storedOnFile = new Set<string>();
    for (const attachment of seriesAttachments) {
      const storedId = attachment.external_id?.trim() ?? "";
      if (storedId && !storedByExternalId.has(storedId)) {
        storedByExternalId.set(storedId, attachment);
      }
      if (attachment.file_id === fileId && storedId) {
        storedOnFile.add(storedId);
      }
    }
    for (const file of existingSeriesFiles) {
      const storedId = file.file_external_id?.trim() ?? "";
      if (storedId && !storedByExternalId.has(storedId)) {
        storedByExternalId.set(storedId, {
          series_id: seriesId,
          file_id: file.id,
          file_name: "",
          mime_type: "image/jpeg",
          storage_url: "",
          external_id: storedId,
        });
      }
      if (file.id === fileId && storedId) storedOnFile.add(storedId);
    }

    const attachments: ResolvedImportAttachment[] = incomingAttachments.map(
      (attachment) => {
        const attachmentId = attachment.externalId?.trim() ?? "";
        const stored = attachmentId
          ? storedByExternalId.get(attachmentId)
          : undefined;
        const alreadyOnFile = Boolean(attachmentId && storedOnFile.has(attachmentId));
        const reuse =
          !alreadyOnFile && stored?.storage_url
            ? {
                file_name: stored.file_name || attachment.fileName,
                mime_type: stored.mime_type || attachment.mimeType,
                storage_url: stored.storage_url,
              }
            : null;
        if (attachmentId) {
          storedOnFile.add(attachmentId);
          storedByExternalId.set(attachmentId, {
            series_id: seriesId,
            file_id: fileId,
            file_name: attachment.fileName,
            mime_type: attachment.mimeType,
            storage_url: stored?.storage_url ?? "",
            external_id: attachmentId,
          });
        }
        return {
          ...attachment,
          alreadyOnFile,
          reuse,
        };
      },
    );
    attachmentsBySeries.set(seriesId, [
      ...seriesAttachments,
      ...attachments
        .filter((attachment) => attachment.externalId)
        .map((attachment) => ({
          series_id: seriesId,
          file_id: fileId,
          file_name: attachment.fileName,
          mime_type: attachment.mimeType,
          storage_url: attachment.reuse?.storage_url ?? "",
          external_id: attachment.externalId,
        })),
    ]);

    const hasExpiration = Boolean(row.startDate || row.expirationDate);

    items.push({
      rowNumber: row.rowNumber,
      action: existingVersion ? "update" : "create",
      seriesAction: "reuse",
      id: fileId,
      seriesId,
      externalId: row.externalId,
      complexId: options.complexId,
      version: row.version,
      title: existingSeries?.title ?? "",
      tagId,
      residentId,
      startDate: hasExpiration ? row.startDate : null,
      expirationDate: hasExpiration ? row.expirationDate : null,
      createdAt: row.createdAt,
      createdByUserId,
      fileExternalId: incomingAttachments[0]?.externalId ?? null,
      attachments,
    });
  }

  return { ok: true, items };
}
