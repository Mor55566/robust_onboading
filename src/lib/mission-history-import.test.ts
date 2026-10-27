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

  it("parses an X mark as an unticked checklist item", () => {
    const items = parseMissionHistoryChecklistBlob("מיקום\n\tנוקה: X ");
    assert.equal(items[0]?.itemType, "checklist");
    assert.equal(items[0]?.isCompleted, false);
    assert.equal(items[0]?.answerValue, null);
  });

  it("keeps a label split by a newline inside one tabbed item", () => {
    const blob =
      "מינוס 1 < מינוס 1 / חניון \n\tהנע גנרטור: V \n\tפאזה R\n מתח בין פאזות: 400 \n\tמתח בין פאזות ואפס\nפאזה R: 231 \n\tוודא תדר 50Hz: 50";
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.deepEqual(
      items.map((item) => [item.label, item.answerValue]),
      [
        ["הנע גנרטור", null],
        ["פאזה R\nמתח בין פאזות", "400"],
        ["מתח בין פאזות ואפס\nפאזה R", "231"],
        ["וודא תדר 50Hz", "50"],
      ],
    );
    assert.ok(items.every((item) => item.location === "מינוס 1 < מינוס 1 / חניון"));
  });

  it("imports a sprinkler-pump check with its numeric readings as answered items", () => {
    const blob = [
      "מינוס 1 < מינוס 1 / חניון ",
      "\tלנטרל מערכת גלוי אש: V ",
      "\tוודא שיחידת משאבת מתזים  נקיה מגופים זרים: V ",
      "\tלחץ מים בזמן הבדיקה: 256 ",
      "\tהנע משאבה למשך 10 דקות: V ",
      "\tוודא שאין נזלות מים: V ",
      "\tוודא שאין חימום יתר: V ",
      "\tלעביר את המשאבה למצב אוטומט אחרי בדיקה: V ",
      "\tלהחזיר מערכת גילוי אש למצב רגיל: V ",
      "\tמתח חשמל פזאה R: 398 ",
      "\tמתח חשמל פזאה S: 397 ",
      "\tמתח חשמל פזאה T: 397 ",
      "\tזרם בפזאה R: 128 ",
      "\tזרם בפזאה S: 121 ",
      "\tזרם בפזאה T: 132",
    ].join("\n");
    const items = parseMissionHistoryChecklistBlob(blob);
    assert.equal(items.length, 14);
    assert.ok(items.every((item) => item.location === "מינוס 1 < מינוס 1 / חניון"));
    assert.ok(items.every((item) => item.isCompleted));
    assert.deepEqual(
      items
        .filter((item) => item.itemType === "number")
        .map((item) => [item.label, item.answerValue]),
      [
        ["לחץ מים בזמן הבדיקה", "256"],
        ["מתח חשמל פזאה R", "398"],
        ["מתח חשמל פזאה S", "397"],
        ["מתח חשמל פזאה T", "397"],
        ["זרם בפזאה R", "128"],
        ["זרם בפזאה S", "121"],
        ["זרם בפזאה T", "132"],
      ],
    );
    assert.equal(items.filter((item) => item.itemType === "checklist").length, 7);
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
    ["X", "checklist"],
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

  it("parses the current Visitt export (BOM, updated due date column, multi-location checks)", () => {
    const header =
      '\uFEFF"#","מזהה","קישור","משימה","נכס","אזור","סטאטוס","תדירות","בניינים","כתובות בניין","אתרים","משתמש משויך","קטגוריה","נסגר ב","בוצע על ידי","הערה","תאריך יעד מקורי","תאריך יעד מעודכן","סיבה להשלמה באיחור","נפתח בשנית ע״י","זמן פתיחה מחדש","קריאות","מספר קריאות","שעות עבודה","שעות עבודה משוערות","תמונות","בדיקות","עורכים"';
    const checks = [
      "מינוס 1 < מינוס 1 / חניון ",
      "\tלנטרל מערכת גלוי אש: V ",
      "\tלחץ מים בזמן הבדיקה: 256 ",
      "\tמתח חשמל פזאה R: 398 ",
      "\tוודא שאין נזלות מים: X ",
      "מינוס 1 < מינוס 1 / חניון ",
      "\tלנטרל מערכת גלוי אש: V ",
      "בניין A / קומה 37 < קומה 37 / מתקן ניקוי ",
      "\tהאם האינטרקום עובד?: כן ",
      "\tהערות: -",
    ].join("\n");
    const row = `1,"6590930c7aecfe1d2ae7194b","https://app.visitt.io/visit/6590930c7aecfe1d2ae7194b","בדיקה של משאבת מתזים חשמלית","TOU Towers","יחידה צפון","בוצע","שבועית","שטח משותף","","מינוס 1 < מינוס 1 / חניון","סמיון  קיפניס","אחזקה מונעת","03-01-2024 06:50:56","סמיון  קיפניס","","06-01-2024 23:59:59","","","","","","0","","","","${checks}",""`;
    const parsed = parseMissionHistoryImportContent(`${header}\n${row}`, "1.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    const mission = parsed.rows[0]!;
    assert.equal(mission.externalId, "6590930c7aecfe1d2ae7194b");
    assert.equal(mission.status, "closed");
    assert.equal(mission.categoryRaw, "אחזקה מונעת");
    assert.equal(mission.resolvedByNameRaw, "סמיון  קיפניס");
    assert.equal(mission.closedAt, "2024-01-03T06:50:56+03:00");
    assert.equal(mission.dueAt, "2024-01-06T23:59:59+03:00");
    assert.deepEqual(
      mission.checklistItems.map((item) => [
        item.location,
        item.sortOrder,
        item.label,
        item.itemType,
        item.answerValue,
        item.isCompleted,
      ]),
      [
        ["מינוס 1 < מינוס 1 / חניון", 0, "לנטרל מערכת גלוי אש", "checklist", null, true],
        ["מינוס 1 < מינוס 1 / חניון", 1, "לחץ מים בזמן הבדיקה", "number", "256", true],
        ["מינוס 1 < מינוס 1 / חניון", 2, "מתח חשמל פזאה R", "number", "398", true],
        ["מינוס 1 < מינוס 1 / חניון", 3, "וודא שאין נזלות מים", "checklist", null, false],
        ["מינוס 1 < מינוס 1 / חניון", 4, "לנטרל מערכת גלוי אש", "checklist", null, true],
        ["בניין A / קומה 37 < קומה 37 / מתקן ניקוי", 5, "האם האינטרקום עובד?", "options", "כן", true],
        ["בניין A / קומה 37 < קומה 37 / מתקן ניקוי", 6, "הערות", "text", null, false],
      ],
    );

    const [resolved] = classifyMissionHistoryImportRows({
      rows: [mission],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(),
      templatesByNormalizedTitle: new Map(),
      buildings: [],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    // Repeated location blocks for the same place merge into one checklist.
    assert.deepEqual(
      resolved?.checklistGroups.map((group) => [group.title, group.items.length]),
      [
        ["מינוס 1 < מינוס 1 / חניון", 5],
        ["בניין A / קומה 37 < קומה 37 / מתקן ניקוי", 2],
      ],
    );
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

  it("imports an unmatched title standalone, placed by its building and category name", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [
        {
          ...baseRow,
          title: "בדיקה ושאיבת מים בפירים בניין B",
          buildingsRaw: ["בניין B"],
          categoryRaw: "אחזקה מונעת",
        },
      ],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(),
      templatesByNormalizedTitle: new Map(),
      buildings: [
        { id: "building-a", name: "A" },
        { id: "building-b", name: "B" },
      ],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
      categoriesByNormalizedName: new Map([["אחזקה מונעת", "category-1"]]),
    });
    assert.equal(result[0]?.classification, "create");
    assert.equal(result[0]?.unmatchedTemplate, true);
    assert.equal(result[0]?.templateTaskId, null);
    assert.equal(result[0]?.buildingId, "building-b");
    assert.equal(result[0]?.categoryId, "category-1");
  });

  it("falls back to the complex's only building for an unmatched title", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [baseRow],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(),
      templatesByNormalizedTitle: new Map(),
      buildings: [{ id: "building-a", name: "A" }],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    assert.equal(result[0]?.classification, "create");
    assert.equal(result[0]?.buildingId, "building-a");
  });

  it("skips with noBuilding when an unmatched title can't be placed in a building", () => {
    const result = classifyMissionHistoryImportRows({
      rows: [baseRow],
      existingMissionsByExternalId: new Map(),
      existingExternalIdsAllTypes: new Set(),
      templatesByNormalizedTitle: new Map(),
      buildings: [
        { id: "building-a", name: "A" },
        { id: "building-b", name: "B" },
      ],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      usersByNormalizedName: new Map(),
    });
    assert.equal(result[0]?.classification, "skip");
    assert.equal(result[0]?.skipReason, "noBuilding");
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
