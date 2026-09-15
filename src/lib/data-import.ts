export type FloorImportRow = {
  /** 1-based spreadsheet row (header is row 1). */
  rowNumber: number;
  externalId: string;
  name: string;
  number: number;
};

export type { AreaImportIssue, AreaImportRow } from "@/lib/area-import";
export {
  AREA_IMPORT_HEADERS,
  buildAreasCsvTemplate,
  buildAreasExcelTemplate,
  collectMissingFloors,
  parseAreasImportContent,
  planAreasImport,
} from "@/lib/area-import";

export type EquipmentImportRow = {
  /** 1-based spreadsheet row (header is row 1). */
  rowNumber: number;
  building: string;
  name: string;
  /** Location path (floor and/or area hierarchy using " < "). */
  areaName: string;
  description: string;
  equipmentType: string;
  externalId: string;
  qrCode: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  condition: string;
  estimatedLifespanYears: string;
  installationDate: string;
  replacementCost: string;
  installationCost: string;
  warrantyExpirationDate: string;
};

export type ImportParseError = "invalid" | "empty" | "invalidRow";

export const FLOOR_IMPORT_HEADERS = [
  "#",
  "מזהה",
  "קומה",
  "מפלס",
  "מספר אתרים",
  "דיירים פעילים",
  "שטחים מושכרים",
  "מזהה חיצוני",
] as const;
export const EQUIPMENT_IMPORT_HEADERS = [
  "#", "מזהה", "אתר", "שם", "בניין", "סוג", "מפרט", "מס\"ד", "קוד QR",
  "דגם", "יצרן", "מצב הציוד", "יתרת חיי הציוד (שנים)", "סיום חיי הציוד",
  "תאריך תפוגת אחריות", "עלות החלפה", "עלות התקנה", "תאריך התקנה",
  "תוחלת חיים משוערת (שנים)", "תאריך יצירה",
] as const;

const FLOOR_SAMPLE_ROWS: FloorImportRow[] = [
  { rowNumber: 2, externalId: "floor-37", name: "קומה 37", number: 38 },
  { rowNumber: 3, externalId: "floor-ground", name: "קומת קרקע", number: 1 },
  { rowNumber: 4, externalId: "floor-b1", name: "מינוס 1", number: 0 },
];

const EQUIPMENT_SAMPLE_ROW_ADVANCED_FIELDS = {
  serialNumber: "",
  model: "",
  manufacturer: "",
  condition: "",
  estimatedLifespanYears: "",
  installationDate: "",
  replacementCost: "",
  installationCost: "",
  warrantyExpirationDate: "",
};

const EQUIPMENT_SAMPLE_ROWS: EquipmentImportRow[] = [
  {
    rowNumber: 2,
    building: "Building A",
    name: "HVAC unit",
    areaName: "Ground floor",
    description: "",
    equipmentType: "",
    externalId: "eq-hvac-1",
    qrCode: "EQ-100",
    ...EQUIPMENT_SAMPLE_ROW_ADVANCED_FIELDS,
  },
  {
    rowNumber: 3,
    building: "Building A",
    name: "Front desk computer",
    areaName: "Ground floor < Lobby",
    description: "",
    equipmentType: "",
    externalId: "",
    qrCode: "",
    ...EQUIPMENT_SAMPLE_ROW_ADVANCED_FIELDS,
  },
];

export function buildFloorsCsvTemplate(): string {
  return buildCsvTemplate(
    [...FLOOR_IMPORT_HEADERS],
    FLOOR_SAMPLE_ROWS.map((row, index) => [
      String(index + 1), row.externalId, row.name, String(row.number),
      "0", "0", "0", "",
    ]),
  );
}

export function buildFloorsExcelTemplate(): string {
  return buildExcelTemplate(
    "Floors",
    [...FLOOR_IMPORT_HEADERS],
    FLOOR_SAMPLE_ROWS.map((row, index) => [
      { value: String(index + 1), type: "Number" },
      { value: row.externalId, type: "String" },
      { value: row.name, type: "String" },
      { value: String(row.number), type: "Number" },
      { value: "0", type: "Number" },
      { value: "0", type: "Number" },
      { value: "0", type: "Number" },
      { value: "", type: "String" },
    ]),
  );
}

export function buildEquipmentCsvTemplate(buildingName = ""): string {
  const sampleBuilding = buildingName.trim() || "בניין A";
  return buildCsvTemplate(
    [...EQUIPMENT_IMPORT_HEADERS],
    EQUIPMENT_SAMPLE_ROWS.map((row, index) => [
      String(index + 1), row.externalId, row.areaName, row.name, sampleBuilding,
      row.equipmentType, row.description, "", row.qrCode,
      "", "", "", "", "", "", "", "", "", "", "",
    ]),
  );
}

export function buildEquipmentExcelTemplate(buildingName = ""): string {
  const sampleBuilding = buildingName.trim() || "בניין A";
  return buildExcelTemplate(
    "Equipment",
    [...EQUIPMENT_IMPORT_HEADERS],
    EQUIPMENT_SAMPLE_ROWS.map((row, index) => [
      { value: String(index + 1), type: "Number" },
      { value: row.externalId, type: "String" },
      { value: row.areaName, type: "String" },
      { value: row.name, type: "String" },
      { value: sampleBuilding, type: "String" },
      { value: row.equipmentType, type: "String" },
      { value: row.description, type: "String" },
      { value: "", type: "String" },
      { value: row.qrCode, type: "String" },
      ...Array.from({ length: 11 }, () => ({ value: "", type: "String" as const })),
    ]),
  );
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseFloorsImportContent(
  content: string,
  fileName: string,
): { rows: FloorImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0].map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, [
    "external id",
    "external_id",
    "extenral id",
    "מזהה",
  ]);
  const explicitExternalIdIndex = findHeaderIndex(header, ["מזהה חיצוני"]);
  const nameIndex = findHeaderIndex(header, ["name", "קומה"]);
  const numberIndex = findHeaderIndex(header, [
    "floor number",
    "floor_number",
    "number",
    "מפלס",
  ]);

  if (nameIndex < 0 || numberIndex < 0) return { error: "invalid" };

  const rows: FloorImportRow[] = [];
  const dataRows = raw.rows.slice(1);
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;
    const rowNumber = i + 2;
    const name = (cells[nameIndex] ?? "").trim();
    const numberRaw = (cells[numberIndex] ?? "").trim();
    const explicitExternalId = explicitExternalIdIndex >= 0
      ? (cells[explicitExternalIdIndex] ?? "").trim()
      : "";
    const externalId = explicitExternalId || (externalIdIndex >= 0
      ? (cells[externalIdIndex] ?? "").trim()
      : "");
    if (!name || !numberRaw) {
      return {
        error: "invalidRow",
        message: `Row ${rowNumber}: name and floor number are required.`,
      };
    }
    const number = Number(normalizeNumberText(numberRaw));
    if (!Number.isInteger(number)) {
      return {
        error: "invalidRow",
        message: `Row ${rowNumber}: floor number must be a whole number.`,
      };
    }
    rows.push({ rowNumber, externalId, name, number });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

function normalizeNumberText(value: string) {
  // Excel / rich text often uses Unicode minus/dashes instead of ASCII "-".
  return value.trim().replace(/[−–—]/g, "-");
}

export function parseEquipmentImportContent(
  content: string,
  fileName: string,
): { rows: EquipmentImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0].map((cell) => normalizeHeader(cell));
  const buildingIndex = findHeaderIndex(header, [
    "building name",
    "building",
    "בניין",
  ]);
  const nameIndex = findHeaderIndex(header, ["name", "name*", "שם"]);
  const areaNameIndex = findHeaderIndex(header, [
    "area name",
    "area name*",
    "area",
    "location",
    "אתר",
  ]);
  const descriptionIndex = findHeaderIndex(header, ["description", "מפרט"]);
  const equipmentTypeIndex = findHeaderIndex(header, [
    "equipment_type",
    "equipment type",
    "type",
    "סוג",
  ]);
  const externalIdIndex = findHeaderIndex(header, [
    "external_id",
    "external id",
    "externalid",
    "מזהה",
  ]);
  const qrCodeIndex = findHeaderIndex(header, ["qr_code", "qr code", "qr", "קוד qr"]);
  const serialNumberIndex = findHeaderIndex(header, [
    "serial number",
    "serial_number",
    'מס"ד',
  ]);
  const modelIndex = findHeaderIndex(header, ["model", "דגם"]);
  const manufacturerIndex = findHeaderIndex(header, [
    "manufacturer",
    "יצרן",
  ]);
  const conditionIndex = findHeaderIndex(header, [
    "condition",
    "equipment condition",
    "מצב הציוד",
  ]);
  const estimatedLifespanYearsIndex = findHeaderIndex(header, [
    "estimated lifespan (years)",
    "estimated_lifespan_years",
    "estimated lifespan years",
    "תוחלת חיים משוערת (שנים)",
  ]);
  const installationDateIndex = findHeaderIndex(header, [
    "installation date",
    "installation_date",
    "תאריך התקנה",
  ]);
  const replacementCostIndex = findHeaderIndex(header, [
    "replacement cost",
    "replacement_cost",
    "עלות החלפה",
  ]);
  const installationCostIndex = findHeaderIndex(header, [
    "installation cost",
    "installation_cost",
    "עלות התקנה",
  ]);
  const warrantyExpirationDateIndex = findHeaderIndex(header, [
    "warranty expiration date",
    "warranty_expiration_date",
    "תאריך תפוגת אחריות",
  ]);

  if (nameIndex < 0 || areaNameIndex < 0) return { error: "invalid" };

  const rows: EquipmentImportRow[] = [];
  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;
    const rowNumber = i + 1;
    const name = (cells[nameIndex] ?? "").trim();
    const areaName = (cells[areaNameIndex] ?? "").trim();
    const building =
      buildingIndex >= 0 ? (cells[buildingIndex] ?? "").trim() : "";
    const description =
      descriptionIndex >= 0 ? (cells[descriptionIndex] ?? "").trim() : "";
    const equipmentType =
      equipmentTypeIndex >= 0 ? (cells[equipmentTypeIndex] ?? "").trim() : "";
    const externalId =
      externalIdIndex >= 0 ? (cells[externalIdIndex] ?? "").trim() : "";
    const qrCode = qrCodeIndex >= 0 ? (cells[qrCodeIndex] ?? "").trim() : "";
    const serialNumber =
      serialNumberIndex >= 0 ? (cells[serialNumberIndex] ?? "").trim() : "";
    const model = modelIndex >= 0 ? (cells[modelIndex] ?? "").trim() : "";
    const manufacturer =
      manufacturerIndex >= 0 ? (cells[manufacturerIndex] ?? "").trim() : "";
    const condition =
      conditionIndex >= 0 ? (cells[conditionIndex] ?? "").trim() : "";
    const estimatedLifespanYears =
      estimatedLifespanYearsIndex >= 0
        ? (cells[estimatedLifespanYearsIndex] ?? "").trim()
        : "";
    const installationDate =
      installationDateIndex >= 0
        ? (cells[installationDateIndex] ?? "").trim()
        : "";
    const replacementCost =
      replacementCostIndex >= 0
        ? (cells[replacementCostIndex] ?? "").trim()
        : "";
    const installationCost =
      installationCostIndex >= 0
        ? (cells[installationCostIndex] ?? "").trim()
        : "";
    const warrantyExpirationDate =
      warrantyExpirationDateIndex >= 0
        ? (cells[warrantyExpirationDateIndex] ?? "").trim()
        : "";
    if (!name) {
      return {
        error: "invalidRow",
        message: `__row__:${rowNumber}`,
      };
    }
    rows.push({
      rowNumber,
      building,
      name,
      areaName,
      description,
      equipmentType,
      externalId,
      qrCode,
      serialNumber,
      model,
      manufacturer,
      condition,
      estimatedLifespanYears,
      installationDate,
      replacementCost,
      installationCost,
      warrantyExpirationDate,
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

function parseNamedRows(
  content: string,
  fileName: string,
  requiredHeaders: string[],
): { rows: Record<string, string>[] } | { error: ImportParseError } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0].map((cell) => normalizeHeader(cell));
  const indexes = Object.fromEntries(
    requiredHeaders.map((key) => [key, header.indexOf(normalizeHeader(key))]),
  ) as Record<string, number>;

  if (Object.values(indexes).some((index) => index < 0)) {
    return { error: "invalid" };
  }

  const rows: Record<string, string>[] = [];
  for (const cells of raw.rows.slice(1)) {
    if (cells.every((cell) => !cell.trim())) continue;
    const row: Record<string, string> = {};
    for (const key of requiredHeaders) {
      row[key] = cells[indexes[key]] ?? "";
    }
    rows.push(row);
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

export function parseRawRows(
  content: string,
  fileName: string,
): { rows: string[][] } | { error: ImportParseError } {
  const decoded = decodeImportText(content);
  const trimmed = decoded.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { error: "empty" };

  // Real .xlsx files are ZIP archives and start with "PK".
  if (trimmed.startsWith("PK")) return { error: "invalid" };

  const lowerName = fileName.toLowerCase();
  const looksLikeXml =
    trimmed.startsWith("<?xml") ||
    trimmed.includes("urn:schemas-microsoft-com:office:spreadsheet") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xml");

  const rows = looksLikeXml
    ? parseSpreadsheetMlRows(trimmed)
    : parseCsvRows(trimmed, detectCsvDelimiter(trimmed));

  if (!rows) return { error: "invalid" };
  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

/** Normalize spreadsheet headers for alias matching. */
export function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ");
}

export function findHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function decodeImportText(content: string) {
  // UTF-16 LE BOM
  if (
    content.length >= 2 &&
    content.charCodeAt(0) === 0xff &&
    content.charCodeAt(1) === 0xfe
  ) {
    const bytes = new Uint8Array(content.length - 2);
    for (let i = 2; i < content.length; i += 1) {
      bytes[i - 2] = content.charCodeAt(i) & 0xff;
    }
    try {
      return new TextDecoder("utf-16le").decode(bytes);
    } catch {
      return content.slice(2);
    }
  }
  // UTF-16 BE BOM
  if (
    content.length >= 2 &&
    content.charCodeAt(0) === 0xfe &&
    content.charCodeAt(1) === 0xff
  ) {
    const bytes = new Uint8Array(content.length - 2);
    for (let i = 2; i < content.length; i += 1) {
      bytes[i - 2] = content.charCodeAt(i) & 0xff;
    }
    try {
      return new TextDecoder("utf-16be").decode(bytes);
    } catch {
      return content.slice(2);
    }
  }
  // UTF-16 LE without BOM: "a\0b\0..." pattern in the header line.
  if (
    content.length > 4 &&
    content.charCodeAt(1) === 0 &&
    content.charCodeAt(3) === 0 &&
    content.includes("\u0000")
  ) {
    try {
      const bytes = new Uint8Array(content.length);
      for (let i = 0; i < content.length; i += 1) {
        bytes[i] = content.charCodeAt(i) & 0xff;
      }
      return new TextDecoder("utf-16le").decode(bytes);
    } catch {
      return content;
    }
  }
  return content;
}

export function detectCsvDelimiter(content: string): "," | ";" | "\t" {
  const firstLine = content.split(/\r\n|\n|\r/)[0] ?? "";
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;

  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i]!;
    if (char === '"') {
      if (inQuotes && firstLine[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (inQuotes) continue;
    if (char === ",") commas += 1;
    else if (char === ";") semicolons += 1;
    else if (char === "\t") tabs += 1;
  }

  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

export function buildCsvTemplate(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}

export function buildExcelTemplate(
  sheetName: string,
  headers: string[],
  rows: { value: string; type: "String" | "Number" }[][],
): string {
  const headerCells = headers
    .map(
      (header) =>
        `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`,
    )
    .join("");
  const dataRows = rows
    .map((row) => {
      const cells = row
        .map(
          (cell) =>
            `<Cell><Data ss:Type="${cell.type}">${escapeXml(cell.value)}</Data></Cell>`,
        )
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>
`;
}

function parseCsvRows(
  content: string,
  delimiter: "," | ";" | "\t" = ",",
): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        // End the field only when the closing quote is followed by a delimiter,
        // newline, or EOF. A lone " mid-field (e.g. Hebrew gershayim in Visitt
        // headers like אתר - מס"ד / נסגר ע"י) is treated as a literal character.
        if (
          next === undefined ||
          next === delimiter ||
          next === "\n" ||
          next === "\r"
        ) {
          inQuotes = false;
        } else {
          cell += '"';
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      // RFC 4180 quoted fields start with ". Mid-field quotes (e.g. Hebrew
      // gershayim in Visitt headers like נסגר ע"י) stay literal.
      if (cell.length === 0) {
        inQuotes = true;
      } else {
        cell += '"';
      }
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseSpreadsheetMlRows(content: string): string[][] | null {
  try {
    const doc = new DOMParser().parseFromString(content, "application/xml");
    if (doc.querySelector("parsererror")) return null;

    const rowNodes = [...doc.getElementsByTagName("Row")];
    if (rowNodes.length === 0) return null;

    return rowNodes.map((rowNode) => {
      const cells = [...rowNode.getElementsByTagName("Cell")];
      return cells.map((cell) => {
        const data = cell.getElementsByTagName("Data")[0];
        return (data?.textContent ?? cell.textContent ?? "").trim();
      });
    });
  } catch {
    return null;
  }
}

function escapeCsvValue(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
