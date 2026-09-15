import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";

export const USER_IMPORT_HEADERS = [
  "מזהה",
  "שם",
  "אימייל",
  "מספר טלפון",
  "תפקיד",
  "תיאור תפקיד",
] as const;

export type UserImportRow = {
  rowNumber: number;
  externalId: string;
  fullName: string;
  email: string;
  phoneNumber: number | null;
  sourceRole: string;
  roleDescription: number | null;
};

const SAMPLE_ROWS = [
  ["user-001", "ישראל ישראלי", "israel@example.com", "501234567", "מנהל נכס", "101"],
  ["user-002", "נועה כהן", "noa@example.com", "", "משתמש", ""],
];

export function buildUsersCsvTemplate() {
  return buildCsvTemplate([...USER_IMPORT_HEADERS], SAMPLE_ROWS);
}

export function buildUsersExcelTemplate() {
  return buildExcelTemplate(
    "Users",
    [...USER_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) => row.map((value) => ({ value, type: "String" as const }))),
  );
}

function optionalInteger(value: string): number | null | undefined {
  const normalized = value.trim().replace(/[\s()-]/g, "");
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function parseUsersImportContent(
  content: string,
  fileName: string,
): { rows: UserImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map(normalizeHeader);
  const externalIdIndex = findHeaderIndex(header, ["מזהה", "id", "external id", "external_id"]);
  const nameIndex = findHeaderIndex(header, ["שם", "שם מלא", "name", "full name", "full_name"]);
  const emailIndex = findHeaderIndex(header, ["אימייל", "מייל", "email", "e-mail"]);
  const phoneIndex = findHeaderIndex(header, ["מספר טלפון", "טלפון", "phone", "phone number", "phone_number"]);
  const roleIndex = findHeaderIndex(header, ["תפקיד", "role"]);
  const roleDescriptionIndex = findHeaderIndex(header, ["תיאור תפקיד", "role description", "role_description"]);
  if (externalIdIndex < 0 || nameIndex < 0 || emailIndex < 0 || roleIndex < 0) {
    return { error: "invalid" };
  }

  const rows: UserImportRow[] = [];
  const seenExternalIds = new Set<string>();
  const seenEmails = new Set<string>();
  for (let index = 1; index < raw.rows.length; index += 1) {
    const cells = raw.rows[index]!;
    if (cells.every((cell) => !cell.trim())) continue;
    const externalId = (cells[externalIdIndex] ?? "").trim();
    const fullName = (cells[nameIndex] ?? "").trim();
    const email = (cells[emailIndex] ?? "").trim().toLocaleLowerCase();
    if (!email) continue;
    const sourceRole = (cells[roleIndex] ?? "").trim();
    const phoneNumber = optionalInteger(phoneIndex < 0 ? "" : (cells[phoneIndex] ?? ""));
    const roleDescription = optionalInteger(
      roleDescriptionIndex < 0 ? "" : (cells[roleDescriptionIndex] ?? ""),
    );
    const externalKey = externalId.toLocaleLowerCase();
    if (
      !externalId ||
      !fullName ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      !sourceRole ||
      phoneNumber === undefined ||
      roleDescription === undefined ||
      seenExternalIds.has(externalKey) ||
      seenEmails.has(email)
    ) {
      return { error: "invalidRow", message: `__row__:${index + 1}` };
    }
    seenExternalIds.add(externalKey);
    seenEmails.add(email);
    rows.push({ rowNumber: index + 1, externalId, fullName, email, phoneNumber, sourceRole, roleDescription });
  }
  return rows.length ? { rows } : { error: "empty" };
}
