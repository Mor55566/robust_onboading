import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTasksCsvTemplate,
  parseTasksImportContent,
  parseChecklistItems,
  resolveTaskImportRows,
  splitUrls,
} from "./task-import";

describe("tasks CSV import", () => {
  it("round-trips the generated template", () => {
    const parsed = parseTasksImportContent(
      buildTasksCsvTemplate(),
      "tasks-template.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.callNumber, "453055");
  });

  it("parses Visitt headers with Hebrew gershayim quotes", () => {
    const csv = [
      "תיאור,דחיפות,סטאטוס,תאריך יצירה,בניין,מיקום,מספר קריאה,נסגר ע\"י",
      "נא לטפל,medium,open,02-08-2026 05:53:21,בניין B,loc,453055,",
    ].join("\n");
    const parsed = parseTasksImportContent(csv, "visitt.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.description, "נא לטפל");
    assert.equal(parsed.rows[0]?.callNumber, "453055");
  });

  it("parses semicolon-delimited Hebrew Excel exports", () => {
    const csv =
      "תיאור;דחיפות;סטאטוס;תאריך יצירה;בניין;מיקום;מספר קריאה\n" +
      "נא לטפל;medium;open;02-08-2026 05:53:21;בניין B;loc;453055";
    const parsed = parseTasksImportContent(csv, "visitt.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.callNumber, "453055");
  });

  it("parses image URLs separated by newlines, commas, or semicolons", () => {
    const url =
      "https://res.cloudinary.com/gantzi/image/upload/c_scale/plfxpejgbj2atjaqsviy.jpg";
    assert.deepEqual(splitUrls(url), [url]);
    assert.deepEqual(splitUrls(`${url}\n${url}`), [url]);
    assert.deepEqual(splitUrls(`${url},${url}`), [url]);
    assert.deepEqual(splitUrls(`${url};${url}`), [url]);
  });

  it("parses opening-image URLs from CSV rows", () => {
    const url =
      "https://res.cloudinary.com/gantzi/image/upload/c_scale/plfxpejgbj2atjaqsviy.jpg";
    const csv = [
      "תיאור,תמונות הקריאה,מספר קריאה",
      `נא לטפל,${url},453055`,
    ].join("\n");
    const parsed = parseTasksImportContent(csv, "visitt.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(parsed.rows[0]?.imageUrls, [url]);
  });

  it("parses checklist items in order and preserves their completion state", () => {
    assert.deepEqual(
      parseChecklistItems("לוח חשמל קבלים צילר 1:No;לוח חשמל קבלים צילר 2:Yes"),
      [
        { label: "לוח חשמל קבלים צילר 1", isCompleted: false },
        { label: "לוח חשמל קבלים צילר 2", isCompleted: true },
      ],
    );
  });

  it("reads the Hebrew checklist column and distinguishes it from a missing column", () => {
    const withChecklist = parseTasksImportContent(
      "תיאור,צ'קליסט\nבדיקה,פריט ראשון:No;פריט שני:Yes",
      "visitt.csv",
    );
    assert.ok(!("error" in withChecklist), JSON.stringify(withChecklist));
    assert.deepEqual(withChecklist.rows[0]?.checklistItems, [
      { label: "פריט ראשון", isCompleted: false },
      { label: "פריט שני", isCompleted: true },
    ]);

    const withoutChecklist = parseTasksImportContent("תיאור\nבדיקה", "visitt.csv");
    assert.ok(!("error" in withoutChecklist), JSON.stringify(withoutChecklist));
    assert.equal(withoutChecklist.rows[0]?.checklistItems, null);
  });

  it("resolves the imported ticket number as the call number", () => {
    const parsed = parseTasksImportContent(
      "תיאור,מספר קריאה\nנא לטפל,453055",
      "visitt.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const resolved = resolveTaskImportRows({
      rows: parsed.rows,
      buildings: [],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      users: [],
      categories: [],
      fallbackOpenedByUserId: "user-1",
    });

    assert.ok(resolved.ok, JSON.stringify(resolved));
    assert.equal(resolved.rows[0]?.callNumber, "453055");
  });

  it("reports a missing description column explicitly", () => {
    const parsed = parseTasksImportContent(
      "מספר קריאה,בניין\n453055,בניין B",
      "visitt.csv",
    );
    assert.ok("error" in parsed, JSON.stringify(parsed));
    assert.equal(parsed.error, "invalid");
    assert.equal(parsed.message, "__missing_description__");
  });
});
