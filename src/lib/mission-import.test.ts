import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMissionsCsvTemplate,
  collapseLocationChecklistItems,
  groupMissionChecklistItems,
  MISSING_LOCATION_ORDER_PREFIX,
  missionChecklistSlots,
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

  it("groups by source_index without storing it as the external id", () => {
    const parsed = parseMissionsImportContent(
      "source_index,assignment_name,checklist_name\n1,בדיקה,ראשונה\n1,בדיקה,שנייה\n2,אחרת,בדוק",
      "export.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.externalId, "");
    assert.equal(parsed.rows[0]?.checklistItems.length, 2);
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

  it("carries paused state from exporter rows through database resolution", () => {
    for (const [value, expected] of [
      ["yes", true], [" YES ", true], ["true", true], ["1", true],
      ["no", false], ["false", false], ["0", false], ["", false],
    ] as const) {
      const parsed = parseMissionsImportContent(
        `source_index,assignment_name,is_paused,checklist_name\n1,בדיקה,${value},ראשונה\n1,בדיקה,${value},שנייה`,
        "export.csv",
      );
      assert.ok(!("error" in parsed), JSON.stringify(parsed));
      assert.equal(parsed.rows[0]?.isPaused, expected);
      const resolved = resolveMissionImportRows({
        rows: parsed.rows,
        buildings: [], floorsByBuilding: new Map(), areasByBuilding: new Map(),
        users: [], categories: [], fallbackOpenedByUserId: "fallback",
      });
      assert.ok(resolved.ok);
      assert.equal(resolved.rows[0]?.isPaused, expected);
    }
  });

  it("leaves paused state unknown when the column is missing", () => {
    const parsed = parseMissionsImportContent(
      "source_index,assignment_name\n1,בדיקה", "legacy.csv",
    );
    assert.ok(!("error" in parsed));
    assert.equal(parsed.rows[0]?.isPaused, null);
  });

  it("rejects invalid or conflicting paused values", () => {
    for (const rows of ["1,בדיקה,maybe", "1,בדיקה,yes\n1,בדיקה,no"]) {
      const parsed = parseMissionsImportContent(
        `source_index,assignment_name,is_paused\n${rows}`, "invalid.csv",
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

  it("rejects a multi-location export without location_order (the exporter missed the סדר step)", () => {
    const csv = [
      "source_index,assignment_name,assignees,location,checklist_title,checklist_order,checklist_name,field_type",
      '1,"בדיקת כיבוי אש","סמיון קיפניס","בניין A / קומה 36 / עמדה 1A","בניין A / קומה 36 / עמדה 1A",1,"בדוק את העמדה",multi_select',
      '1,"בדיקת כיבוי אש","סמיון קיפניס","בניין A / קומה 36 / עמדה 2A","בניין A / קומה 36 / עמדה 2A",1,"בדוק את העמדה",multi_select',
      '2,"בדיקה אחת","סמיון קיפניס","בניין A / קומה 1","בניין A / קומה 1",1,"בדוק",checkbox',
      '3,"סיור","סמיון קיפניס","בניין A / קומה 1;בניין A / קומה 2","בדיקות",1,"בדוק",checkbox',
    ].join("\n");

    const parsed = parseMissionsImportContent(csv, "unordered.csv");
    assert.ok("error" in parsed);
    assert.equal(parsed.message, `${MISSING_LOCATION_ORDER_PREFIX}בדיקת כיבוי אש | סיור`);
  });

  it("accepts a partly ordered export only when every location row has an order", () => {
    const csv = [
      "source_index,assignment_name,location,location_order,checklist_title,checklist_order,checklist_name",
      '1,"בדיקה","בניין A / קומה 1",1,"בניין A / קומה 1",1,"בדוק"',
      '1,"בדיקה","בניין A / קומה 2",,"בניין A / קומה 2",1,"בדוק"',
    ].join("\n");
    const parsed = parseMissionsImportContent(csv, "partial.csv");
    assert.ok("error" in parsed);
    assert.equal(parsed.message, `${MISSING_LOCATION_ORDER_PREFIX}בדיקה`);
  });

  it("preserves separate location checklists when their questions differ", () => {
    const csv = [
      "source_index,assignment_name,building,location,location_order,checklist_title,checklist_order,checklist_name,field_type",
      '1,"בדיקת אל פסק","בניין A","בניין A / קומה 36",1,"בניין A / קומה 36",1,"בדוק לוח 1",checkbox',
      '1,"בדיקת אל פסק","בניין A","בניין A / קומה 35",2,"בניין A / קומה 35",1,"בדוק ארון תקשורת",checkbox',
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
          isRequired: false,
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

  it("keeps one checklist per location in Visitt's location order", () => {
    // Identical questions on every location would normally collapse into one
    // checklist; with location_order they must stay separate and ordered.
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,location,location_order,checklist_title,checklist_order,checklist_name,field_type",
        '1,"סיור","בניין A / קומה 2",3,"בניין A / קומה 2",1,"בדוק",checkbox',
        '1,"סיור","בניין A / קומה 3",1,"בניין A / קומה 3",1,"בדוק",checkbox',
        '1,"סיור","בניין A / קומה 1",2,"בניין A / קומה 1",1,"בדוק",checkbox',
      ].join("\n"),
      "ordered.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const groups = groupMissionChecklistItems(parsed.rows[0]!.checklistItems);
    assert.deepEqual(
      groups.map((group) => group.title),
      ["בניין A / קומה 3", "בניין A / קומה 1", "בניין A / קומה 2"],
    );
  });

  it("parses conditional fields from the exporter's condition columns", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,checklist_title,checklist_order,checklist_name,field_type,options,is_conditional,condition_parent_order,condition_parent_name,condition_option",
        '1,"סיור","גג",1,"עובד",multi_select,"[""כן"",""לא""]",no,,,',
        '1,"סיור","גג",2,"טמפרטורה",number,,yes,1,"עובד","כן"',
        '1,"סיור","גג",3,"רעש",multi_select,"[""כן"",""לא""]",yes,,,"כן"',
      ].join("\n"),
      "conditions.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const items = parsed.rows[0]!.checklistItems;
    assert.equal(items[0]?.showIfSortOrder, null);
    assert.deepEqual(items[0]?.showIfValues, []);
    assert.equal(items[1]?.showIfSortOrder, 0);
    assert.deepEqual(items[1]?.showIfValues, ["כן"]);
    // No resolved parent: the field is imported as always shown.
    assert.equal(items[2]?.showIfSortOrder, null);
    assert.deepEqual(items[2]?.showIfValues, []);
  });

  it("leaves fields unconditional when the file has no condition columns", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,checklist_order,checklist_name,field_type",
        '1,"סיור",1,"בדוק",checkbox',
      ].join("\n"),
      "legacy.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows[0]!.checklistItems[0]?.showIfSortOrder, null);
  });

  it("keeps a comma inside an ordered row's location name", () => {
    const location = "קומה 36 / גלריה 1/ מפוח R1A / יניקה משרותים קומות 26-34 , קומות 10 עד מינוס 4";
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,location,location_order,checklist_title,checklist_name",
        `1,"סיור","${location}",1,"${location}","בדוק"`,
      ].join("\n"),
      "comma.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(parsed.rows[0]?.locations, [location]);
    assert.deepEqual(parsed.rows[0]?.checklistItems[0]?.locations, [location]);
  });

  it("resolves and retains every imported mission location", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,building,location,location_order,checklist_title,checklist_order,checklist_name,field_type",
        '1,"בדיקה","בניין A","בניין A / קומה 1",1,"בדיקות",1,"בדוק",checkbox',
        '1,"בדיקה","בניין A","בניין A / קומה 2",2,"בדיקות",1,"בדוק",checkbox',
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
    // One checklist row per location, sharing the card's title and checks.
    assert.deepEqual(
      resolved.rows[0]?.checklistGroups.map((group) => [group.title, group.locations]),
      [
        ["בדיקות", [{ buildingId: "building-a", floorId: "floor-1", areaId: null, equipmentId: null, label: "בניין A / קומה 1" }]],
        ["בדיקות", [{ buildingId: "building-a", floorId: "floor-2", areaId: null, equipmentId: null, label: "בניין A / קומה 2" }]],
      ],
    );
  });

  it("places a location in the building its path names, keeping the deepest existing part", () => {
    const roof = "בניין B / קומה 35 < קומה 35 / גג טכני < קומה 35 / גג טכני / צ'ילר 2";
    const missing = "בניין B / קומה 35 < קומה 35 / גרעין < קומה 35 / גריען / עמדה 3B";
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,building,location,location_order,checklist_title,checklist_order,checklist_name,field_type",
        `1,"סיור","בניין A, בניין B","${roof}",1,"${roof}",1,"בדוק",checkbox`,
        `1,"סיור","בניין A, בניין B","${missing}",2,"${missing}",1,"בדוק",checkbox`,
      ].join("\n"),
      "prefixed.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const floors = (prefix: string, id: string) => [
      { id, name: `${prefix} / קומה 35`, number: 35 },
    ];
    const areas = (floorId: string, id: string) => [
      { id, name: "קומה 35 / גג טכני", floor_id: floorId, parent_area_id: null },
    ];
    const resolved = resolveMissionImportRows({
      rows: parsed.rows,
      buildings: [
        { id: "building-a", name: "בניין A" },
        { id: "building-b", name: "בניין B" },
      ],
      floorsByBuilding: new Map([
        ["building-a", floors("בניין A", "floor-a35")],
        ["building-b", floors("בניין B", "floor-b35")],
      ]),
      areasByBuilding: new Map([
        ["building-a", areas("floor-a35", "roof-a")],
        ["building-b", areas("floor-b35", "roof-b")],
      ]),
      users: [],
      categories: [],
      fallbackOpenedByUserId: "fallback-user",
    });
    assert.ok(resolved.ok);
    assert.deepEqual(
      resolved.rows[0]?.checklistGroups.map((group) =>
        group.locations.map(({ buildingId, floorId, areaId }) => ({ buildingId, floorId, areaId })),
      ),
      [
        [{ buildingId: "building-b", floorId: "floor-b35", areaId: "roof-b" }],
        [{ buildingId: "building-b", floorId: "floor-b35", areaId: null }],
      ],
    );
  });

  it("keeps a multi-location card as one card: a row per location, same title and checks", () => {
    const pumps = [
      "בניין A / קומה 35 < קומה 35 / גג טכני < קומה 35 / גג טכני / משאבת P13A חיוני",
      "בניין A / קומה 35 < קומה 35 / גג טכני < קומה 35 / גג טכני / משאבת P12A חיוני",
    ];
    const tank = "בניין A / קומה 35 < קומה 35 / גג טכני < קומה 35 / גג טכני / מאגר מים ממוחזרים";
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,location,location_order,checklist_title,checklist_order,checklist_name,field_type",
        `1,"סיור","${tank}",1,"${tank}",1,"בדוק מאגר",checkbox`,
        `1,"סיור","${pumps[0]}",2,"${pumps.join(" | ")}",1,"עובד",checkbox`,
        `1,"סיור","${pumps[0]}",2,"${pumps.join(" | ")}",2,"רעש",checkbox`,
        `1,"סיור","${pumps[1]}",3,"${pumps.join(" | ")}",1,"עובד",checkbox`,
        `1,"סיור","${pumps[1]}",3,"${pumps.join(" | ")}",2,"רעש",checkbox`,
      ].join("\n"),
      "pumps.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));

    const slots = missionChecklistSlots(parsed.rows[0]!.checklistItems);
    const card = pumps.join(" | ");
    assert.deepEqual(
      slots.map((slot) => [slot.title, slot.location, slot.items.map((item) => item.label)]),
      [
        [tank, tank, ["בדוק מאגר"]],
        [card, pumps[0], ["עובד", "רעש"]],
        [card, pumps[1], ["עובד", "רעש"]],
      ],
    );
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
      { buildingId: "building-a", floorId: "floor-36", areaId: "core-36", equipmentId: "station-1a" },
    ]);
    assert.deepEqual(resolved.rows[0]?.checklistGroups[0]?.locations, [{
      buildingId: "building-a", floorId: "floor-36", areaId: "core-36", equipmentId: "station-1a",
      label: "בניין A / קומה 36 < קומה 36 / גרעין < קומה 36 / גרעין / עמדת כיבוי אש מס' 1A",
    }]);
  });

  it("keeps legacy imports as one checklist when no checklist title exists", () => {
    const groups = groupMissionChecklistItems([
      {
        checklistTitle: "",
        sortOrder: 0,
        label: "בדיקה ראשונה",
        itemType: "checklist",
        fieldTypeOriginal: "צ׳ק",
        isRequired: false,
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
        isRequired: false,
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

describe("checklist slots in Visitt's order", () => {
  it("orders each location of a card by its location_order across cards", () => {
    const parsed = parseMissionsImportContent(
      [
        "source_index,assignment_name,location,location_order,checklist_title,checklist_order,checklist_name,field_type",
        '1,"סיור","גג / צ\'ילר 1",3,"צ\'ילרים",1,"עובד",checkbox',
        '1,"סיור","גג / צ\'ילר 2",1,"צ\'ילרים",1,"עובד",checkbox',
        '1,"סיור","חדר חשמל",2,"חדר חשמל",1,"לוח",checkbox',
      ].join("\n"),
      "ordered.csv",
    );
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(
      missionChecklistSlots(parsed.rows[0]!.checklistItems).map((slot) => [slot.title, slot.location]),
      [["צ'ילרים", "גג / צ'ילר 2"], ["חדר חשמל", "חדר חשמל"], ["צ'ילרים", "גג / צ'ילר 1"]],
    );
  });
});
