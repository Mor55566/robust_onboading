import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";

// Matches the CSV downloaded by the tenant-contacts export script
// (src/lib/tenant-users-export-script.ts).
export const RESIDENT_USER_IMPORT_HEADERS = [
  "דייר",
  "שם",
  "תפקיד",
  "אימייל",
  "טלפון",
] as const;

// Visitt's tenant-manager role; these contacts become household admins.
export const RESIDENT_ADMIN_ROLE = "מנהל/ת דייר";

export type ResidentUserImportRow = {
  rowNumber: number;
  resident: string;
  name: string;
  role: string;
  email: string;
  phone: string;
};

const SAMPLE_ROWS = [
  ["דייר לדוגמה", "ישראל ישראלי", "עובד/ת", "israel@example.com", "+972501234567"],
  ["דייר לדוגמה", "רונית כהן", RESIDENT_ADMIN_ROLE, "", "+972521234567"],
];

export function buildResidentUsersCsvTemplate(): string {
  return buildCsvTemplate([...RESIDENT_USER_IMPORT_HEADERS], SAMPLE_ROWS);
}

export function buildResidentUsersExcelTemplate(): string {
  return buildExcelTemplate(
    "Tenant users",
    [...RESIDENT_USER_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) =>
      row.map((value) => ({ value, type: "String" as const })),
    ),
  );
}

// The export script prefixes values starting with "+", "=", "-", "@" with an
// apostrophe so spreadsheets don't read them as formulas — strip it back off.
function unescapeCell(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.startsWith("'") ? trimmed.slice(1).trim() : trimmed;
}

export function parseResidentUsersImportContent(
  content: string,
  fileName: string,
):
  | { rows: ResidentUserImportRow[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const residentIndex = findHeaderIndex(header, ["דייר", "tenant", "resident"]);
  const nameIndex = findHeaderIndex(header, ["שם", "name"]);
  const roleIndex = findHeaderIndex(header, ["תפקיד", "role"]);
  const emailIndex = findHeaderIndex(header, ["אימייל", "email", "מייל"]);
  const phoneIndex = findHeaderIndex(header, ["טלפון", "phone"]);
  if (residentIndex < 0 || nameIndex < 0) return { error: "invalid" };

  const rows: ResidentUserImportRow[] = [];
  for (let index = 1; index < raw.rows.length; index += 1) {
    const cells = raw.rows[index]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const resident = unescapeCell(cells[residentIndex]);
    const name = unescapeCell(cells[nameIndex]);
    const email = emailIndex >= 0 ? unescapeCell(cells[emailIndex]) : "";
    if (
      !resident ||
      !name ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      return { error: "invalidRow", message: `__row__:${index + 1}` };
    }
    rows.push({
      rowNumber: index + 1,
      resident,
      name,
      role: roleIndex >= 0 ? unescapeCell(cells[roleIndex]) : "",
      email,
      phone: phoneIndex >= 0 ? unescapeCell(cells[phoneIndex]) : "",
    });
  }

  return rows.length > 0 ? { rows } : { error: "empty" };
}
