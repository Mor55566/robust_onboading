import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseResidentsImportContent } from "@/lib/resident-import";

describe("residents CSV import", () => {
  it("parses the Hebrew Visitt resident export", () => {
    const csv = '\uFEFF"#","מזהה","בניין","קוד דייר","שם","שטחים מושכרים","סטאטוס","אנשי קשר","נרשמו ל-Visitt+","שם חברה","שם איש קשר","כתובת דייר לחיוב"\n1,"6864f3bf363a4cc6ed3f38a0","","","אנבידיה","","נוכחי","נופר","1 / 1","","",""';
    const result = parseResidentsImportContent(csv, "residents.csv");
    assert.ok("rows" in result);
    assert.deepEqual(result.rows, [
      {
        rowNumber: 2,
        externalId: "6864f3bf363a4cc6ed3f38a0",
        building: "",
        name: "אנבידיה",
        billingAddress: "",
        contacts: [{ name: "נופר", role: null }],
      },
    ]);
  });

  it("accepts a building name", () => {
    const csv = "id,building,name\nabc,Building A,Resident A";
    const result = parseResidentsImportContent(csv, "residents.csv");
    assert.ok("rows" in result);
    assert.equal(result.rows[0]?.building, "Building A");
  });

  it("parses multiple contacts separated by semicolons, with and without a role", () => {
    const csv =
      'id,name,אנשי קשר\nabc,Resident A,"זיו - מנדיי ;אלמוג - מנדיי"\ndef,Resident B,"ליה גולדמן ;רנה בורושטיין"';
    const result = parseResidentsImportContent(csv, "residents.csv");
    assert.ok("rows" in result);
    assert.deepEqual(result.rows[0]?.contacts, [
      { name: "זיו", role: "מנדיי" },
      { name: "אלמוג", role: "מנדיי" },
    ]);
    assert.deepEqual(result.rows[1]?.contacts, [
      { name: "ליה גולדמן", role: null },
      { name: "רנה בורושטיין", role: null },
    ]);
  });

  it("parses a billing address column", () => {
    const csv =
      'id,name,כתובת דייר לחיוב\nabc,Resident A,"יצחק שדה 4"';
    const result = parseResidentsImportContent(csv, "residents.csv");
    assert.ok("rows" in result);
    assert.equal(result.rows[0]?.billingAddress, "יצחק שדה 4");
  });

  it("defaults billing address and contacts to empty when the columns are absent", () => {
    const csv = "id,building,name\nabc,Building A,Resident A";
    const result = parseResidentsImportContent(csv, "residents.csv");
    assert.ok("rows" in result);
    assert.equal(result.rows[0]?.billingAddress, "");
    assert.deepEqual(result.rows[0]?.contacts, []);
  });
});
