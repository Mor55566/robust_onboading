import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEquipmentCsvTemplate,
  buildFloorsCsvTemplate,
  parseEquipmentImportContent,
  parseFloorsImportContent,
} from "./data-import";

describe("floor import", () => {
  it("parses the Hebrew Visitt floors export format", () => {
    const content = '\uFEFF"#","מזהה","קומה","מפלס","מספר אתרים","דיירים פעילים","שטחים מושכרים","מזהה חיצוני"\n1,"floor-37","בניין A / קומה 37","38","0","0","0",""\n2,"floor-ground","קומת קרקע","1","0","0","0","preferred-id"';
    const result = parseFloorsImportContent(content, "floors.csv");

    assert.deepEqual(result, {
      rows: [
        { externalId: "floor-37", name: "בניין A / קומה 37", number: 38 },
        { externalId: "preferred-id", name: "קומת קרקע", number: 1 },
      ],
    });
  });

  it("uses the supported Hebrew format for the downloadable template", () => {
    const result = parseFloorsImportContent(buildFloorsCsvTemplate(), "floors.csv");
    assert.ok("rows" in result);
    assert.equal(result.rows.length, 3);
  });

  it("continues to support the original English format", () => {
    const result = parseFloorsImportContent(
      "external id,name,floor number\nfl-1,Floor 1,1",
      "floors.csv",
    );
    assert.deepEqual(result, {
      rows: [{ externalId: "fl-1", name: "Floor 1", number: 1 }],
    });
  });
});

describe("equipment import", () => {
  it("parses the attached Hebrew export shape and its location path", () => {
    const content = '\uFEFF"#","מזהה","אתר","שם","בניין","סוג","מפרט","מס\"ד","קוד QR","דגם","יצרן","מצב הציוד","יתרת חיי הציוד (שנים)","סיום חיי הציוד","תאריך תפוגת אחריות","עלות החלפה","עלות התקנה","תאריך התקנה","תוחלת חיים משוערת (שנים)","תאריך יצירה"\n1,"eq-1","בניין A / קומה 35 < גג טכני < מפוח 1","מפוח 1","בניין A","מפוח","מפרט בדיקה","","QR-1","","","","","","","","","","",""';
    const result = parseEquipmentImportContent(content, "equipment.csv");
    assert.ok("rows" in result);
    assert.deepEqual(result.rows[0], {
      rowNumber: 2,
      externalId: "eq-1",
      areaName: "בניין A / קומה 35 < גג טכני < מפוח 1",
      name: "מפוח 1",
      building: "בניין A",
      equipmentType: "מפוח",
      description: "מפרט בדיקה",
      qrCode: "QR-1",
      serialNumber: "",
      model: "",
      manufacturer: "",
      condition: "",
      estimatedLifespanYears: "",
      installationDate: "",
      replacementCost: "",
      installationCost: "",
      warrantyExpirationDate: "",
    });
  });

  it("parses the advanced equipment metadata columns", () => {
    const content = '﻿"#","מזהה","אתר","שם","בניין","סוג","מפרט","מס\"ד","קוד QR","דגם","יצרן","מצב הציוד","יתרת חיי הציוד (שנים)","סיום חיי הציוד","תאריך תפוגת אחריות","עלות החלפה","עלות התקנה","תאריך התקנה","תוחלת חיים משוערת (שנים)","תאריך יצירה"\n1,"eq-1","בניין A / קומה 35 < גג טכני < מפוח 1","מפוח 1","בניין A","מפוח","מפרט בדיקה","SN-1","QR-1","דגם X","חברת יצרן","טוב","","","2028-01-15","5000","800","2023-06-01","10",""';
    const result = parseEquipmentImportContent(content, "equipment.csv");
    assert.ok("rows" in result);
    assert.deepEqual(result.rows[0], {
      rowNumber: 2,
      externalId: "eq-1",
      areaName: "בניין A / קומה 35 < גג טכני < מפוח 1",
      name: "מפוח 1",
      building: "בניין A",
      equipmentType: "מפוח",
      description: "מפרט בדיקה",
      qrCode: "QR-1",
      serialNumber: "SN-1",
      model: "דגם X",
      manufacturer: "חברת יצרן",
      condition: "טוב",
      estimatedLifespanYears: "10",
      installationDate: "2023-06-01",
      replacementCost: "5000",
      installationCost: "800",
      warrantyExpirationDate: "2028-01-15",
    });
  });

  it("round-trips the new downloadable template", () => {
    const result = parseEquipmentImportContent(buildEquipmentCsvTemplate(), "equipment.csv");
    assert.ok("rows" in result);
    assert.equal(result.rows.length, 2);
  });
});
