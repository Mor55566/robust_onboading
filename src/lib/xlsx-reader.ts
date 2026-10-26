// Minimal .xlsx reader for the upload modals: unzips the workbook with the
// browser's DecompressionStream, reads the first sheet and returns it as CSV
// text, so every existing CSV parser handles real Excel files unchanged.
// Date cells become "D-M-YYYY HH:MM" — the Visitt export shape
// parseImportDate already reads as Israel wall-clock time.

export function isZipFile(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  name: string,
): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const data = bytes.slice(start, start + entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) return null;
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
}

function byLocalName(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS("*", name));
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code: string): boolean {
  // Drop quoted literals, escapes and [color]/[locale] blocks, then look for
  // date/time tokens.
  const cleaned = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(cleaned);
}

function dateStyleIndexes(stylesDoc: Document | null): Set<number> {
  const result = new Set<number>();
  if (!stylesDoc) return result;
  const customDate = new Set<number>();
  for (const numFmt of byLocalName(stylesDoc, "numFmt")) {
    if (isDateFormat(numFmt.getAttribute("formatCode") ?? "")) {
      customDate.add(Number(numFmt.getAttribute("numFmtId")));
    }
  }
  const cellXfs = byLocalName(stylesDoc, "cellXfs")[0];
  if (!cellXfs) return result;
  Array.from(cellXfs.children).forEach((xf, index) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) result.add(index);
  });
  return result;
}

function formatExcelDate(serial: number): string {
  // Excel's day 0 is 1899-12-30 (accounting for its 1900 leap-year bug).
  const date = new Date(Math.round((serial - 25569) * 86_400_000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCDate()}-${date.getUTCMonth() + 1}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function toCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function firstSheetPath(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
): Promise<string | null> {
  const workbookText = await readZipText(bytes, entries, "xl/workbook.xml");
  const relsText = await readZipText(bytes, entries, "xl/_rels/workbook.xml.rels");
  const workbook = workbookText ? parseXml(workbookText) : null;
  const rels = relsText ? parseXml(relsText) : null;
  const sheet = workbook ? byLocalName(workbook, "sheet")[0] : undefined;
  const relId =
    sheet?.getAttribute("r:id") ??
    sheet?.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    );
  if (rels && relId) {
    const rel = byLocalName(rels, "Relationship").find(
      (node) => node.getAttribute("Id") === relId,
    );
    const target = rel?.getAttribute("Target");
    if (target) {
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (entries.has(path)) return path;
    }
  }
  return entries.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : null;
}

/** Converts the first worksheet of an .xlsx file to CSV, or null if unreadable. */
export async function xlsxToCsv(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const bytes = new Uint8Array(buffer);
    const entries = readZipDirectory(bytes);
    if (!entries) return null;

    const sheetPath = await firstSheetPath(bytes, entries);
    if (!sheetPath) return null;
    const sheetText = await readZipText(bytes, entries, sheetPath);
    const sheet = sheetText ? parseXml(sheetText) : null;
    if (!sheet) return null;

    const sharedText = await readZipText(bytes, entries, "xl/sharedStrings.xml");
    const sharedDoc = sharedText ? parseXml(sharedText) : null;
    const sharedStrings = sharedDoc
      ? byLocalName(sharedDoc, "si").map((si) =>
          byLocalName(si, "t").map((t) => t.textContent ?? "").join(""),
        )
      : [];

    const stylesText = await readZipText(bytes, entries, "xl/styles.xml");
    const dateStyles = dateStyleIndexes(stylesText ? parseXml(stylesText) : null);

    const rows: string[][] = [];
    for (const rowNode of byLocalName(sheet, "row")) {
      const rowIndex = Number(rowNode.getAttribute("r") ?? rows.length + 1) - 1;
      const cells: string[] = [];
      let nextColumn = 0;
      for (const cell of Array.from(rowNode.children)) {
        if (cell.localName !== "c") continue;
        const ref = cell.getAttribute("r");
        const column = ref ? columnIndex(ref) : nextColumn;
        nextColumn = column + 1;
        const type = cell.getAttribute("t");
        const raw = byLocalName(cell, "v")[0]?.textContent ?? "";
        let value: string;
        if (type === "s") {
          value = sharedStrings[Number(raw)] ?? "";
        } else if (type === "inlineStr") {
          value = byLocalName(cell, "t").map((t) => t.textContent ?? "").join("");
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else if (
          raw &&
          type !== "str" &&
          dateStyles.has(Number(cell.getAttribute("s") ?? -1)) &&
          Number.isFinite(Number(raw))
        ) {
          value = formatExcelDate(Number(raw));
        } else {
          value = raw;
        }
        cells[column] = value;
      }
      rows[rowIndex] = Array.from(cells, (value) => value ?? "");
    }

    const csv = Array.from(rows, (row) => (row ?? []).map(toCsvCell).join(",")).join("\r\n");
    return csv.trim() ? csv : null;
  } catch {
    return null;
  }
}
