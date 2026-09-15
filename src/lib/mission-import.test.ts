import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMissionsCsvTemplate,
  collapseLocationChecklistItems,
  groupMissionChecklistItems,
  parseMissionFrequency,
  parseMissionImportDate,
  parseMissionsImportContent,
  resolveMissionImportRows,
} from "./mission-import";

describe("scheduled missions CSV import", () => {
  it("carries holiday booleans from exporter rows through database resolution", () => {
    for (const [value, expected] of [
      ["yes", true], ["true", true], [" YES ", true], ["1", true],
      ["no", false], ["false", false], ["0", false], ["", false],
    ] as const) {
      const parsed = parseMissionsImportContent(
        `source_index,assignment_name,frequency,skip_on_holidays,checklist_name\n1,בדיקה,יומית,${value},ראשונה\n1,בדיקה,יומית,${value},שנייה`,
        "export.csv",
      );
      assert.ok(!("error" in parsed), JSON.stringify(parsed));
      assert.equal(parsed.rows.length, 1);
      assert.equal(parsed.rows[0]?.skipHolidays, expected);
      assert.equal(parsed.rows[0]?.checklistItems.length, 2);
      const resolved = resolveMissionImportRows({
        rows: parsed.rows,
        buildings: [], floorsByBuilding: new Map(), areasByBuilding: new Map(),
        users: [], categories: [], fallbackOpenedByUserId: "fallback",
      });
      assert.ok(resolved.ok);
      assert.equal(resolved.rows[0]?.skipHolidays, expected);
    }
  });

  it("defaults missing holiday columns to false", () => {
    const parsed = parseMissionsImportContent(
      "source_index,assignment_name\n1,בדיקה", "legacy.csv",
    );
    assert.ok(!("error" in parsed));
    assert.equal(parsed.rows[0]?.skipHolidays, false);
  });

  it("rejects invalid or conflicting holiday values", () => {
    for (const rows of ["1,בדיקה,maybe", "1,בדיקה,yes\n1,בדיקה,no"]) {
      const parsed = parseMissionsImportContent(
        `source_index,assignment_name,skip_on_holidays\n${rows}`, "invalid.csv",
      );
      assert.ok("error" in parsed);
      assert.equal(parsed.error, "invalidRow");
    }
  });

  it("round-trips the generated template", () => {
    const parsed = parseMissionsImportContent(
      buildMissionsCsvTemplate(),
      "scheduled-missions-template.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.externalId, "Afy8iZwboyHnC5HjM");
    assert.equal(parsed.rows[0]?.title, "בדיקה של משאבת מתזים חשמלית");
  });

  it("parses Visitt export headers", () => {
    const csv = [
      '#,"מזהה","שם","תדירות","בניינים","כתובות בניין","קטגוריה","משתמש משויך","ריצה הבאה","תאריך התחלה","GPS","תיאור","בדיקות","מיקומים","שעות עבודה משוערות","תאריך יצירה","נוצר ע\"י"',
      '1,"ext-1","בדיקה שבועית","שבועית","שטח משותף","","אחזקה מונעת","סרגיי גורינוב","","4/2/23","ללא","","item one;item two","מינוס 1 / משותף","","4/11/23, 9:08 AM","אורה סרטורי"',
    ].join("\n");
    const parsed = parseMissionsImportContent(csv, "missions.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.externalId, "ext-1");
    assert.deepEqual(parsed.rows[0]?.locations, ["מינוס 1 / משותף"]);
    assert.deepEqual(parsed.rows[0]?.assignees, ["סרגיי גורינוב"]);
    assert.equal(parsed.rows[0]?.createdAt, "2023-04-11T09:08:00+03:00");
  });

  it("collapses location-named checklist rows into one checklist inside one mission", () => {
    const csv = [
      "source_index,assignment_name,assignees,location,checklist_title,checklist_order,checklist_name,field_type",
      '1,"בדיקת כיבוי אש","סמיון קיפניס, סרגיי גורינוב","בניין A / קומה 36 / עמדה 1A","בניין A / קומה 36 / עמדה 1A",1,"בדוק את העמדה",multi_select',
      '1,"בדיקת כיבוי אש","סמיון קיפניס, סרגיי גורינוב","בניין A / קומה 36 / עמדה 2A","בניין A / קומה 36 / עמדה 2A",1,"בדוק את העמדה",multi_select',
    ].join("\n");

    const parsed = parseMissionsImportContent(csv, "locations.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.rows[0]?.assignees, [
      "סמיון קיפניס",
      "סרגיי גורינוב",
    ]);
    assert.deepEqual(parsed.rows[0]?.locations, [
      "בניין A / קומה 36 / עמדה 1A",
      "בניין A / קומה 36 / עמדה 2A",
    ]);

    const groups = groupMissionChecklistItems(parsed.rows[0]!.checklistItems);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.title, "בדיקות");
    assert.equal(groups[0]?.items.length, 1);
    assert.deepEqual(groups[0]?.locations, [
      "בניין A / קומה 36 / עמדה 1A",
      "בניין A / קומה 36 / עמדה 2A",
    ]);
  });

  it("preserves separate location checklists when their questions differ", () => {
    const csv = [
      "source_index,assignment_name,building,location,checklist_title,checklist_order,checklist_name,field_type",
      '1,"בדיקת אל פסק","בניין A","בניין A / קומה 36","בניין A / קומה 36",1,"בדוק לוח 1",checkbox',
      '1,"בדיקת אל פסק","בניין A","בניין A / קומה 35","בניין A / קומה 35",1,"בדוק ארון תקשורת",checkbox',
    ].join("\n");

    const parsed = parseMissionsImportContent(csv, "multiple-checklists.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    const groups = groupMissionChecklistItems(parsed.rows[0]!.checklistItems);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((group) => group.locations), [
      ["בניין A / קומה 36"],
      ["בניין A / קומה 35"],
    ]);
  });

  it("parses assigned_users, trims comma-separated names, and merges names across checklist rows", () => {
    const csv = [
      "source_index,assignment_name,assigned_users,checklist_name",
      '1,"בדיקה","  סמיון קיפניס , סרגיי גורינוב  ","בדיקה ראשונה"',
      '1,"בדיקה","סרגיי גורינוב, אורה סרטורי","בדיקה שנייה"',
    ].join("\n");

    const parsed = parseMissionsImportContent(csv, "assigned-users.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(parsed.rows[0]?.assignees, [
      "סמיון קיפניס",
      "סרגיי גורינוב",
      "אורה סרטורי",
    ]);
  });

  it("keeps assignees empty when assigned_users is absent", () => {
    const parsed = parseMissionsImportContent(
      "source_index,assignment_name,checklist_name\n1,בדיקה,בדוק",
      "without-assigned-users.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(parsed.rows[0]?.assignees, []);
  });

  it("matches assignees by normalized name, ignores unknown names, and deduplicates user ids", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,assigned_users,building",
        '1,"בדיקה"," סמיון   קיפניס, לא קיים,סמיון קיפניס","בניין A"',
      ].join("\n"),
      "resolve-assigned-users.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const resolved = resolveMissionImportRows({
      rows: parsed.rows,
      buildings: [{ id: "building-a", name: "בניין A" }],
      floorsByBuilding: new Map(),
      areasByBuilding: new Map(),
      users: [
        { id: "user-1", full_name: "סמיון קיפניס", building_id: "building-a" },
      ],
      categories: [],
      fallbackOpenedByUserId: "fallback-user",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.rows[0]?.assigneeIds, ["user-1"]);
  });

  it("does not collapse intentional checklist groups that are not location titles", () => {
    const items = collapseLocationChecklistItems(
      [
        {
          checklistTitle: "ציוד",
          sortOrder: 0,
          label: "בדוק ציוד",
          itemType: "checklist",
          fieldTypeOriginal: "צ׳ק",
          numberUnit: null,
          numberRule: null,
          numberMin: null,
          numberMax: null,
          options: [],
        },
      ],
      ["בניין A / קומה 1"],
    );
    assert.equal(items[0]?.checklistTitle, "ציוד");
  });

  it("resolves and retains every imported mission location", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,building,location,checklist_title,checklist_order,checklist_name,field_type",
        '1,"בדיקה","בניין A","בניין A / קומה 1;בניין A / קומה 2","בדיקות",1,"בדוק",checkbox',
      ].join("\n"),
      "locations.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const resolved = resolveMissionImportRows({
      rows: parsed.rows,
      buildings: [{ id: "building-a", name: "בניין A" }],
      floorsByBuilding: new Map([
        [
          "building-a",
          [
            { id: "floor-1", name: "קומה 1", number: 1 },
            { id: "floor-2", name: "קומה 2", number: 2 },
          ],
        ],
      ]),
      areasByBuilding: new Map(),
      users: [],
      categories: [],
      fallbackOpenedByUserId: "fallback-user",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.rows[0]?.locations, [
      { buildingId: "building-a", floorId: "floor-1", areaId: null },
      { buildingId: "building-a", floorId: "floor-2", areaId: null },
    ]);
    assert.equal(resolved.rows[0]?.floorId, "floor-1");
    assert.deepEqual(resolved.rows[0]?.checklistGroups[0]?.locations, [
      { buildingId: "building-a", floorId: "floor-1", areaId: null },
      { buildingId: "building-a", floorId: "floor-2", areaId: null },
    ]);
  });

  it("retains locations concatenated without a separator under one mission", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,building,location,checklist_name",
        '2,"בדיקה שנתית - אל פסק","בניין A, בניין B","בניין A / קומה 36בניין A","בדוק"',
      ].join("\n"),
      "concatenated-building.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const resolved = resolveMissionImportRows({
      rows: parsed.rows,
      buildings: [
        { id: "building-a", name: "בניין A" },
        { id: "building-b", name: "בניין B" },
      ],
      floorsByBuilding: new Map([
        ["building-a", [{ id: "floor-36", name: "בניין A / קומה 36", number: 36 }]],
      ]),
      areasByBuilding: new Map(),
      users: [],
      categories: [],
      fallbackOpenedByUserId: "fallback-user",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.rows[0]?.locations, [
      { buildingId: "building-a", floorId: "floor-36", areaId: null },
      { buildingId: "building-a", floorId: null, areaId: null },
    ]);
  });

  it("maps an imported equipment leaf to its selectable floor or area", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,building,location,checklist_title,checklist_order,checklist_name,field_type",
        '1,"בדיקה","בניין A","בניין A / קומה 36 < קומה 36 / גרעין < קומה 36 / גרעין / עמדת כיבוי אש מס\' 1A","בדיקות",1,"בדוק",checkbox',
      ].join("\n"),
      "equipment-location.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const resolved = resolveMissionImportRows({
      rows: parsed.rows,
      buildings: [{ id: "building-a", name: "בניין A" }],
      floorsByBuilding: new Map([
        ["building-a", [{ id: "floor-36", name: "בניין A / קומה 36", number: 36 }]],
      ]),
      areasByBuilding: new Map([
        [
          "building-a",
          [{ id: "core-36", name: "קומה 36 / גרעין", floor_id: "floor-36", parent_area_id: null }],
        ],
      ]),
      equipmentByBuilding: new Map([
        [
          "building-a",
          [{
            id: "station-1a",
            name: "קומה 36 / גרעין / עמדת כיבוי אש מס' 1A",
            building_id: "building-a",
            floor_id: "floor-36",
            area_id: "core-36",
          }],
        ],
      ]),
      users: [],
      categories: [],
      fallbackOpenedByUserId: "fallback-user",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.rows[0]?.locations, [
      { buildingId: "building-a", floorId: "floor-36", areaId: "core-36" },
    ]);
  });

  it("keeps legacy imports as one checklist when no checklist title exists", () => {
    const groups = groupMissionChecklistItems([
      {
        checklistTitle: "",
        sortOrder: 0,
        label: "בדיקה ראשונה",
        itemType: "checklist",
        fieldTypeOriginal: "צ׳ק",
        numberUnit: null,
        numberRule: null,
        numberMin: null,
        numberMax: null,
        options: [],
      },
      {
        checklistTitle: "",
        sortOrder: 1,
        label: "בדיקה שנייה",
        itemType: "checklist",
        fieldTypeOriginal: "צ׳ק",
        numberUnit: null,
        numberRule: null,
        numberMin: null,
        numberMax: null,
        options: [],
      },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.title, "בדיקות");
    assert.equal(groups[0]?.items.length, 2);
  });

  it("maps Hebrew frequencies", () => {
    assert.equal(parseMissionFrequency("שבועית").frequency, "week");
    assert.equal(parseMissionFrequency("שנתית").frequency, "year");
    assert.equal(parseMissionFrequency("חודשית").frequency, "month");
    assert.equal(parseMissionFrequency("תלת חודשית").frequency, "custom");
    assert.equal(parseMissionFrequency("תלת חודשית").intervalCount, 3);
    assert.equal(parseMissionFrequency("דו-חודשית").intervalCount, 2);
  });

  it("parses daily frequency with Hebrew weekday lists", () => {
    const schedule = parseMissionFrequency("יומית: (א׳;ב׳;ג׳;ד׳;ה׳)");
    assert.equal(schedule.frequency, "day");
    assert.deepEqual(schedule.weekdays, [0, 1, 2, 3, 4]);
  });

  it("parses weekly frequency with a Hebrew weekday", () => {
    const schedule = parseMissionFrequency("שבועית: ראשון");
    assert.equal(schedule.frequency, "week");
    assert.equal(schedule.weekday, 0);
  });

  it("parses US-style dates from Visitt exports", () => {
    assert.equal(
      parseMissionImportDate("4/11/23, 9:08 AM"),
      "2023-04-11T09:08:00+03:00",
    );
    assert.equal(parseMissionImportDate("9/8/26, 0:00"), "2026-09-08T00:00:00+03:00");
  });
});
