import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMissionHistoryImportRows,
  inferChecklistItemFromValue,
  parseMissionHistoryChecklistBlob,
  parseMissionHistoryImportContent,
  parseMissionHistoryStatus,
} from "./mission-history-import";

describe("mission history checklist blob parser", () => {
  it("parses single-line items under one location", () => {
    const blob =
      "בניין B / קומת קרקע < חדר ציוד חירום \n\tספוגים: 28 \n\tדלי: 1 \n\tבדיקת מגפונים : תקין";
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.equal(items.length, 3);
    assert.equal(items[0]?.location, "בניין B / קומת קרקע < חדר ציוד חירום");
    assert.equal(items[0]?.label, "ספוגים");
    assert.equal(items[0]?.itemType, "number");
    assert.equal(items[0]?.answerValue, "28");
    assert.equal(items[2]?.itemType, "options");
    assert.equal(items[2]?.answerValue, "תקין");
    assert.deepEqual(items[2]?.options, ["תקין", "לא תקין"]);
  });

  it("collapses a multi-line numbered item into a single item", () => {
    const blob = [
      "בניין A / קומה 36 < עמדת כיבוי אש מס' 1A",
      "\t1. בדוק הימצאות 2 זרנוקים,",
      "2. בדוק הימצאות 1 מזנק",
      "3. בדוק ניקיון העמדה.",
      "9. יש לבדוק איטום אש בין הקומות. : תקין",
      "בניין A / קומה 36 < עמדת כיבוי אש מס' 2A",
      "\t1. בדוק שוב : לא תקין",
    ].join("\n");
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.location, "בניין A / קומה 36 < עמדת כיבוי אש מס' 1A");
    assert.ok(items[0]?.label.includes("1. בדוק הימצאות 2 זרנוקים"));
    assert.ok(items[0]?.label.includes("9. יש לבדוק איטום אש בין הקומות."));
    assert.equal(items[0]?.answerValue, "תקין");
    assert.equal(items[1]?.location, "בניין A / קומה 36 < עמדת כיבוי אש מס' 2A");
    assert.equal(items[1]?.answerValue, "לא תקין");
  });

  it("tolerates blank lines mid-blob", () => {
    const blob = "מיקום\n\tא: 1\n\n\tב: 2\n";
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.equal(items.length, 2);
  });

  it("parses a V checkbox mark and a dash as no-answer", () => {
    const blob = "מיקום\n\tהופעל: V \n\tמצב: - ";
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.equal(items[0]?.itemType, "checklist");
    assert.equal(items[0]?.isCompleted, true);
    assert.equal(items[1]?.answerValue, null);
  });

  it("extracts a unit suffix from a numeric value", () => {
    const blob = "מיקום\n\tארגז ג'ל: 15יח";
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.equal(items[0]?.itemType, "number");
    assert.equal(items[0]?.answerValue, "15");
    assert.equal(items[0]?.numberUnit, "יח");
  });
});

describe("inferChecklistItemFromValue", () => {
  for (const [value, itemType] of [
    ["תקין", "options"],
    ["לא", "options"],
    ["כן", "options"],
    ["-", "text"],
    ["V", "checklist"],
    ["40", "number"],
    ["26.4", "number"],
    ["טקסט חופשי כלשהו", "text"],
  ] as const) {
    it(`maps ${JSON.stringify(value)} to ${itemType}`, () => {
      assert.equal(inferChecklistItemFromValue(value).itemType, itemType);
    });
  }
});

describe("parseMissionHistoryStatus", () => {
  it("maps בוצע to closed and לא בוצע to open", () => {
    assert.equal(parseMissionHistoryStatus("בוצע"), "closed");
    assert.equal(parseMissionHistoryStatus("לא בוצע"), "open");
    assert.equal(parseMissionHistoryStatus(""), "open");
  });
});

describe("parseMissionHistoryImportContent", () => {
  it("parses the real Visitt header row and dedupes repeated external ids", () => {
    const content = [
      '#,מזהה,קישור,משימה,נכס,אזור,סטאטוס,תדירות,בניינים,כתובות בניין,אתרים,משתמש משויך,קטגוריה,נסגר ב,בוצע על ידי,הערה,תאריך יעד מקורי,סיבה להשלמה באיחור,"נפתח בשנית ע""י",זמן פתיחה מחדש,קריאות,מספר קריאות,שעות עבודה,שעות עבודה משוערות,תמונות,בדיקות,עורכים',
      '1,abc123,https://example.com,בדיקת ציוד חירום,נכס,אזור,בוצע,חודשית,קומת קרקע,,,סרגיי,אחזקה,30-08-2026 09:16:02,סרגיי,,31-08-2026 23:59:59,,,,,,,,,"מיקום\n\tספוגים: 28",',
      '2,abc123,https://example.com,בדיקת ציוד חירום,נכס,אזור,בוצע,חודשית,קומת קרקע,,,סרגיי,אחזקה,30-08-2026 09:16:02,סרגיי,,31-08-2026 23:59:59,,,,,,,,,"מיקום\n\tספוגים: 30",',
    ].join("\n");
    const parsed = parseMissionHistoryImportContent(content, "history.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.externalId, "abc123");
    assert.equal(parsed.rows[0]?.status, "closed");
    assert.equal(parsed.rows[0]?.checklistItems[0]?.answerValue, "28");
  });

  it("flags missing required columns", () => {
    const parsed = parseMissionHistoryImportContent("a,b\n1,2", "bad.csv");
    assert.ok("error" in parsed);
    assert.equal(parsed.error, "invalid");
  });
});

describe("classifyMissionHistoryImportRows", () => {
  const baseRow = {
    rowNumber: 2,
    externalId: "ext-1",
    title: "בדיקת ציוד חירום",
    statusRaw: "בוצע",
    status: "closed" as const,
    buildingsRaw: [],
    categoryRaw: "",
    assignedUserRaw: "",
    closedAt: null,
    resolvedByNameRaw: "",
    note: "",
    dueAt: null,
    imageUrls: [],
    checklistItems: [],
  };

  it("classifies an external-id match as update", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [baseRow],
      existingMissionsByExternalId: new Map([["ext-1", "mission-1"]]),
      existingExternalIdsAllTypes: new Set(["ext-1"]),
      templatesByNormalizedTitle: new Map(),
      buildings: [],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    assert.equal(result[0]?.classification, "update");
    assert.equal(result[0]?.existingMissionId, "mission-1");
  });

  it("classifies a title match (normalized) as create", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [{ ...baseRow, title: "  בדיקת ציוד חירום  " }],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(),
      templatesByNormalizedTitle: new Map([
        ["בדיקת ציוד חירום", { id: "template-1", taskCategoryId: null, buildingId: null, floorId: null, areaId: null }],
      ]),
      buildings: [],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    assert.equal(result[0]?.classification, "create");
    assert.equal(result[0]?.templateTaskId, "template-1");
  });

  it("skips with unmatchedTitle when no template title matches", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [baseRow],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(),
      templatesByNormalizedTitle: new Map(),
      buildings: [],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    assert.equal(result[0]?.classification, "skip");
    assert.equal(result[0]?.skipReason, "unmatchedTitle");
  });

  it("skips with externalIdConflict when the id belongs to a non-mission row", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [baseRow],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(["ext-1"]),
      templatesByNormalizedTitle: new Map([
        ["בדיקת ציוד חירום", { id: "template-1", taskCategoryId: null, buildingId: null, floorId: null, areaId: null }],
      ]),
      buildings: [],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    assert.equal(result[0]?.classification, "skip");
    assert.equal(result[0]?.skipReason, "externalIdConflict");
  });
});
