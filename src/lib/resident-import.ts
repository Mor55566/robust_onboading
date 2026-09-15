import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";

export const RESIDENT_IMPORT_HEADERS = [
  "#",
  "מזהה",
  "בניין",
  "קוד דייר",
  "שם",
  "שטחים מושכרים",
  "סטאטוס",
  "אנשי קשר",
  "נרשמו ל-Visitt+",
  "שם חברה",
  "שם איש קשר",
  "כתובת דייר לחיוב",
] as const;

export type ResidentImportContact = {
  name: string;
  role: string | null;
};

export type ResidentImportRow = {
  rowNumber: number;
  externalId: string;
  building: string;
  name: string;
  billingAddress: string;
  contacts: ResidentImportContact[];
};

function parseContacts(raw: string): ResidentImportContact[] {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)\s-\s(.*)$/);
      if (!match) return { name: part, role: null };
      const name = match[1]!.trim();
      const role = match[2]!.trim();
      return { name, role: role || null };
    })
    .filter((contact) => contact.name.length > 0);
}

const SAMPLE_ROWS = [
  ["1", "resident-001", "", "", "דייר לדוגמה", "", "נוכחי", "", "", "", "", ""],
  ["2", "resident-002", "בניין א", "", "דייר בבניין", "", "נוכחי", "", "", "", "", ""],
];

export function buildResidentsCsvTemplate(): string {
  return buildCsvTemplate([...RESIDENT_IMPORT_HEADERS], SAMPLE_ROWS);
}

export function buildResidentsExcelTemplate(): string {
  return buildExcelTemplate(
    "Residents",
    [...RESIDENT_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) =>
      row.map((value) => ({ value, type: "String" as const })),
    ),
  );
}

export function parseResidentsImportContent(
  content: string,
  fileName: string,
):
  | { rows: ResidentImportRow[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, [
    "מזהה",
    "id",
    "external id",
    "external_id",
  ]);
  const buildingIndex = findHeaderIndex(header, ["בניין", "building"]);
  const nameIndex = findHeaderIndex(header, ["שם", "name", "resident name"]);
  const billingAddressIndex = findHeaderIndex(header, [
    "כתובת דייר לחיוב",
    "billing address",
    "billing_address",
  ]);
  const contactsIndex = findHeaderIndex(header, [
    "אנשי קשר",
    "contacts",
    "contact",
  ]);
  if (externalIdIndex < 0 || nameIndex < 0) return { error: "invalid" };

  const rows: ResidentImportRow[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < raw.rows.length; index += 1) {
    const cells = raw.rows[index]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const externalId = (cells[externalIdIndex] ?? "").trim();
    const name = (cells[nameIndex] ?? "").trim();
    const building =
      buildingIndex >= 0 ? (cells[buildingIndex] ?? "").trim() : "";
    const billingAddress =
      billingAddressIndex >= 0 ? (cells[billingAddressIndex] ?? "").trim() : "";
    const contacts =
      contactsIndex >= 0 ? parseContacts(cells[contactsIndex] ?? "") : [];
    const key = externalId.toLocaleLowerCase();
    if (!externalId || !name || seen.has(key)) {
      return { error: "invalidRow", message: `__row__:${index + 1}` };
    }
    seen.add(key);
    rows.push({
      rowNumber: index + 1,
      externalId,
      building,
      name,
      billingAddress,
      contacts,
    });
  }

  return rows.length > 0 ? { rows } : { error: "empty" };
}
