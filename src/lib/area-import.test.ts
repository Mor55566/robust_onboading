import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAreasCsvTemplate,
  parseAreasImportContent,
  planAreasImport,
  resolveLocationPath,
  type AreaImportExisting,
  type AreaImportFloor,
} from "./area-import";

const buildingName = "בניין A";
const floors: AreaImportFloor[] = [
  { id: "floor-1", name: "קומה 1", number: 1 },
  { id: "floor-2", name: "קומה 2", number: 2 },
];

function parseCsv(csv: string) {
  const parsed = parseAreasImportContent(csv, "areas.csv");
  assert.ok(!("error" in parsed), JSON.stringify(parsed));
  return parsed.rows;
}

describe("areas CSV import", () => {
  it("parses the attached Hebrew export shape and its building", () => {
    const rows = parseCsv('\uFEFF"#","מזהה","מיקום","בניין","שם","סוג","קוד יחידה","מס\"ד","מפרט","קטגוריית אתרים","כתובת","קוד QR","תאריך יצירה"\n1,"area-1","קומת קרקע < לובי ראשי","בניין A","לובי ראשי","","","","","אזור בסיסי","","QR-1",""');
    assert.equal(rows[0]?.building, "בניין A");
    assert.equal(rows[0]?.location, "קומת קרקע < לובי ראשי");
    assert.equal(rows[0]?.externalId, "area-1");
  });

  it("round-trips the new downloadable template", () => {
    assert.equal(parseCsv(buildAreasCsvTemplate()).length, 2);
  });

  it("parses UTF-8 BOM headers and derives name from location", () => {
    const rows = parseCsv(
      "\uFEFFexternal id,location,name,type,QR code\n,מנהרה / חדר מרכז אנרגיה,,,common,\n",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, "מנהרה / חדר מרכז אנרגיה");
    assert.equal(rows[0]?.location, "מנהרה / חדר מרכז אנרגיה");
  });

  it("imports a building-level area with slashes in the name", () => {
    const rows = parseCsv(
      "external id,location,name,type,QR code\next-1,מנהרה / חדר מרכז אנרגיה,,electrical_room,\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => "new-energy",
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0]?.action, "create");
    assert.equal(plan.items[0]?.name, "מנהרה / חדר מרכז אנרגיה");
    assert.equal(plan.items[0]?.floorId, null);
    assert.equal(plan.items[0]?.parentAreaId, null);
    assert.equal(plan.items[0]?.externalId, "ext-1");
  });

  it("nests an area under another area using <", () => {
    const rows = parseCsv(
      [
        "external id,location,name,type,QR code",
        ",מנהרה / חדר מרכז אנרגיה,,,",
        ",מנהרה / חדר מרכז אנרגיה < מינוס 1 / עמדת כיבוי אש,,,",
      ].join("\n"),
    );
    let n = 0;
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => `id-${++n}`,
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items.length, 2);
    assert.equal(plan.items[0]?.name, "מנהרה / חדר מרכז אנרגיה");
    assert.equal(plan.items[0]?.parentAreaId, null);
    assert.equal(plan.items[1]?.name, "מינוס 1 / עמדת כיבוי אש");
    assert.equal(plan.items[1]?.parentAreaId, plan.items[0]?.areaId);
    assert.equal(plan.items[1]?.floorId, null);
    assert.equal(plan.createdParents.length, 0);
  });

  it("creates the parent area when only the nested row is uploaded", () => {
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,מנהרה / חדר מרכז אנרגיה < מינוס 1 / עמדת כיבוי אש,,,\n",
    );
    let n = 0;
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => `id-${++n}`,
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.createdParents.length, 1);
    assert.equal(plan.createdParents[0]?.name, "מנהרה / חדר מרכז אנרגיה");
    assert.equal(plan.items[0]?.name, "מינוס 1 / עמדת כיבוי אש");
    assert.equal(plan.items[0]?.parentAreaId, plan.createdParents[0]?.areaId);
  });

  it("places an area under a floor matched by building / קומה N", () => {
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,בניין A / קומה 2 < קומה 2 / לובי מעליות משא,,elevator_lobby,\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => "lobby",
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0]?.name, "קומה 2 / לובי מעליות משא");
    assert.equal(plan.items[0]?.floorId, "floor-2");
    assert.equal(plan.items[0]?.parentAreaId, null);
    assert.equal(plan.createdParents.length, 0);
  });

  it("supports > as the hierarchy delimiter", () => {
    const resolved = resolveLocationPath(
      "מנהרה / חדר מרכז אנרגיה > מינוס 1 / עמדת כיבוי אש",
      floors,
      buildingName,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.leafName, "מינוס 1 / עמדת כיבוי אש");
    assert.deepEqual(resolved.parentNames, ["מנהרה / חדר מרכז אנרגיה"]);
    assert.equal(resolved.floor, null);
  });

  it("nests under a parent area that already sits on a floor", () => {
    const existing: AreaImportExisting[] = [
      {
        id: "core",
        name: "Core",
        floor_id: "floor-1",
        parent_area_id: null,
      },
    ];
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,קומה 1 < Core < Desk,,office,\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: existing,
      buildingName,
      createId: () => "desk",
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items[0]?.action, "create");
    assert.equal(plan.items[0]?.parentAreaId, "core");
    assert.equal(plan.items[0]?.floorId, "floor-1");
  });

  it("reuses repeated parents across multiple rows", () => {
    const rows = parseCsv(
      [
        "external id,location,name,type,QR code",
        ",מנהרה / חדר מרכז אנרגיה < Women's Restrooms,,restroom,",
        ",מנהרה / חדר מרכז אנרגיה < Men's Restrooms,,restroom,",
      ].join("\n"),
    );
    let n = 0;
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => `id-${++n}`,
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.createdParents.length, 1);
    assert.equal(plan.items.length, 2);
    assert.equal(plan.items[0]?.parentAreaId, plan.items[1]?.parentAreaId);
  });

  it("detects duplicate external ids and conflicts", () => {
    const existing: AreaImportExisting[] = [
      {
        id: "lobby",
        name: "Lobby",
        floor_id: "floor-1",
        parent_area_id: null,
        external_id: "ext-1",
        qr_code: "QR-1",
      },
    ];
    const rows = parseCsv(
      "external id,location,name,type,QR code\next-1,קומה 1 < Mail,,common,QR-2\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: existing,
      buildingName,
      createId: () => "mail",
    });
    assert.equal(plan.items.length, 0);
    assert.equal(plan.issues[0]?.code, "conflict");
  });

  it("re-imports the same file as updates without creating duplicates", () => {
    const existing: AreaImportExisting[] = [
      {
        id: "energy",
        name: "מנהרה / חדר מרכז אנרגיה",
        floor_id: null,
        parent_area_id: null,
        external_id: "ext-1",
        area_type: "electrical_room",
        qr_code: "QR-1",
      },
    ];
    const rows = parseCsv(
      "external id,location,name,type,QR code\next-1,מנהרה / חדר מרכז אנרגיה,,electrical_room,QR-1\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: existing,
      buildingName,
      createId: () => "should-not-create",
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0]?.action, "update");
    assert.equal(plan.items[0]?.areaId, "energy");
    assert.equal(plan.createdParents.length, 0);
  });

  it("can match existing areas by external id only", () => {
    const plan = planAreasImport({
      rows: [{
        rowNumber: 2,
        building: "Building A",
        externalId: "new-external-id",
        location: "Lobby",
        name: "Lobby",
        type: "",
        qrCode: "",
      }],
      floors: [],
      areas: [{
        id: "existing-lobby",
        name: "Lobby",
        floor_id: null,
        parent_area_id: null,
        external_id: "old-external-id",
      }],
      buildingName: "Building A",
      matchExistingByExternalIdOnly: true,
      createId: () => "new-lobby",
    });

    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items[0]?.action, "create");
    assert.equal(plan.items[0]?.areaId, "new-lobby");
  });

  it("matches floors by building-prefixed קומה labels", () => {
    const resolved = resolveLocationPath(
      "בניין A / קומה 2 < קומה 2 / לובי מעליות משא",
      floors,
      buildingName,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.floor?.id, "floor-2");
    assert.deepEqual(resolved.parentNames, []);
    assert.equal(resolved.leafName, "קומה 2 / לובי מעליות משא");
  });

  it("places an area under ground floor (קומה קרקע → 0)", () => {
    const groundFloors: AreaImportFloor[] = [
      ...floors,
      { id: "floor-0", name: "קומה קרקע", number: 0 },
    ];
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,קומה קרקע < דלת מסתובבת - כניסה,,common,\n",
    );
    const plan = planAreasImport({
      rows,
      floors: groundFloors,
      areas: [],
      buildingName,
      createId: () => "door",
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.items[0]?.name, "דלת מסתובבת - כניסה");
    assert.equal(plan.items[0]?.floorId, "floor-0");
    assert.equal(plan.items[0]?.parentAreaId, null);
  });

  it("also accepts קומת קרקע as ground floor", () => {
    const groundFloors: AreaImportFloor[] = [
      { id: "floor-0", name: "Ground", number: 0 },
    ];
    const resolved = resolveLocationPath(
      "קומת קרקע < דלת מסתובבת - כניסה",
      groundFloors,
      buildingName,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.floor?.id, "floor-0");
    assert.equal(resolved.leafName, "דלת מסתובבת - כניסה");
  });

  it("places an area under מינוס 1 with a core parent", () => {
    const basementFloors: AreaImportFloor[] = [
      ...floors,
      { id: "floor-m1", name: "מינוס 1", number: -1 },
    ];
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,מינוס 1 / גרעין B < בניין B / מינוס 1 / מבוא לחדרי חשמל חניון,,electrical_room,\n",
    );
    let n = 0;
    const plan = planAreasImport({
      rows,
      floors: basementFloors,
      areas: [],
      buildingName,
      createId: () => `id-${++n}`,
    });
    assert.equal(plan.issues.length, 0, JSON.stringify(plan.issues));
    assert.equal(plan.createdParents.length, 1);
    assert.equal(plan.createdParents[0]?.name, "גרעין B");
    assert.equal(plan.createdParents[0]?.floorId, "floor-m1");
    assert.equal(plan.items[0]?.name, "בניין B / מינוס 1 / מבוא לחדרי חשמל חניון");
    assert.equal(plan.items[0]?.parentAreaId, plan.createdParents[0]?.areaId);
    assert.equal(plan.items[0]?.floorId, "floor-m1");
  });

  it("reports missing ground floor on review", () => {
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,קומה קרקע < דלת מסתובבת - כניסה,,common,\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => "door",
    });
    assert.equal(plan.items.length, 0);
    assert.equal(plan.issues[0]?.code, "unknownFloor");
    assert.equal(plan.issues[0]?.floorNumber, 0);
    assert.equal(plan.issues[0]?.floorLabel, "קומה קרקע");
  });

  it("reports missing basement floor on review", () => {
    const rows = parseCsv(
      "external id,location,name,type,QR code\n,מינוס 1 / גרעין B < בניין B / מינוס 1 / מבוא,,electrical_room,\n",
    );
    const plan = planAreasImport({
      rows,
      floors,
      areas: [],
      buildingName,
      createId: () => "id-1",
    });
    assert.equal(plan.items.length, 0);
    assert.equal(plan.issues[0]?.code, "unknownFloor");
    assert.equal(plan.issues[0]?.floorNumber, -1);
    assert.equal(plan.issues[0]?.floorLabel, "מינוס 1");
  });

  it("resolves בניין B / קומת קרקע to floor 0 even if another floor shares the name", () => {
    const buildingB = "בניין B";
    const floorsWithCollision: AreaImportFloor[] = [
      { id: "floor-0", name: "Ground floor", number: 0 },
      // Same display name as the ground label, but a different level — should lose.
      { id: "floor-named", name: "קומת קרקע", number: 1 },
      { id: "floor-1", name: "קומה 1", number: 1 },
    ];
    const resolved = resolveLocationPath(
      "בניין B / קומת קרקע < חדר מדרגות 1 בניין B",
      floorsWithCollision,
      buildingB,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.floor?.id, "floor-0");
    assert.equal(resolved.floor?.number, 0);
    assert.equal(resolved.leafName, "חדר מדרגות 1 בניין B");
  });
});
