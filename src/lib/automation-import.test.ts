import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAutomationsImportContent, resolveAutomationImportRows } from "./automation-import";

describe("automation CSV import", () => {
  it("parses > hierarchy and uses action_preview for exported users", () => {
    const csv = [
      "index,trigger_type,priorities,buildings,categories,action_type,users,rule_preview,action_preview,hidden_values,needs_review",
      '4,נפתחת קריאה,כל עדיפות,בניין A,אחזקת שבר,משתמשים משוייכים,בחר משתמש,"בניין A>אחזקת שבר>חשמל, תאורה",ישראל ישראלי,,no',
    ].join("\n");
    const parsed = parseAutomationsImportContent(csv, "automations.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(parsed.rows[0]?.buildingNames, ["בניין A"]);
    assert.deepEqual(parsed.rows[0]?.categoryNames, ["אחזקת שבר"]);
    assert.deepEqual(parsed.rows[0]?.subcategoryNames, ["חשמל", "תאורה"]);
    assert.deepEqual(parsed.rows[0]?.userNames, ["ישראל ישראלי"]);
  });

  it("splits pipe-delimited users and subcategories from the scanner export", () => {
    const csv = [
      "index,trigger_type,buildings,categories,action_type,users,rule_preview,action_preview,needs_review",
      '1,נפתחת קריאה,בניין A,אחזקת שבר,משתמשים משוייכים,"סמיון קיפניס | רן אזולאי","בניין A>אחזקת שבר>חשמל | תאורה","סמיון קיפניס | רן אזולאי",no',
    ].join("\n");
    const parsed = parseAutomationsImportContent(csv, "automations.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.deepEqual(parsed.rows[0]?.userNames, ["סמיון קיפניס", "רן אזולאי"]);
    assert.deepEqual(parsed.rows[0]?.subcategoryNames, ["חשמל", "תאורה"]);
  });

  it("drops the category filter when 'אין קטגוריה' is selected", () => {
    const csv = [
      "index,trigger_type,buildings,categories,action_type,users,rule_preview,action_preview,needs_review",
      '14,נפתחת קריאה,"בניין A | בניין B","אחזקת שבר | אין קטגוריה",משתמשים שיותראו,סמיון קיפניס,"בניין A | בניין B>אחזקת שבר | אין קטגוריה",סמיון קיפניס,no',
    ].join("\n");
    const parsed = parseAutomationsImportContent(csv, "automations.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    assert.equal(parsed.rows[0]?.incompleteReason, "");
    assert.deepEqual(parsed.rows[0]?.buildingNames, ["בניין A", "בניין B"]);
    assert.deepEqual(parsed.rows[0]?.categoryNames, []);
    assert.deepEqual(parsed.rows[0]?.subcategoryNames, []);
    assert.equal(parsed.rows[0]?.actionType, "notify_users");
  });

  it("rejects rows whose +N values were not exported", () => {
    const csv = [
      "index,trigger_type,action_type,rule_preview,action_preview,hidden_values,needs_review",
      "1,נפתחת קריאה,משתמשים משוייכים,בניין A>אחזקת שבר,ישראל,בבניין:+4,yes",
    ].join("\n");
    const parsed = parseAutomationsImportContent(csv, "automations.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    const resolved = resolveAutomationImportRows(parsed.rows, { buildings: [], categories: [], users: [] });
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.match(resolved.message, /חסרים ערכים/);
  });

  it("resolves subcategories only under the resolved parent", () => {
    const csv = [
      "index,trigger_type,buildings,categories,action_type,users,rule_preview,action_preview,needs_review",
      "1,נפתחת קריאה,בניין A,אחזקת שבר,משתמשים משוייכים,ישראל,בניין A>אחזקת שבר>חשמל,ישראל,no",
    ].join("\n");
    const parsed = parseAutomationsImportContent(csv, "automations.csv");
    assert.ok(!("error" in parsed), JSON.stringify(parsed));
    const resolved = resolveAutomationImportRows(parsed.rows, {
      buildings: [{ id: "b1", name: "בניין A" }],
      categories: [
        { id: "c1", name: "אחזקת שבר", parentId: null },
        { id: "s1", name: "חשמל", parentId: "c1" },
        { id: "s2", name: "חשמל", parentId: "c2" },
      ],
      users: [{ id: "u1", name: "ישראל" }],
    });
    assert.ok(resolved.ok, JSON.stringify(resolved));
    assert.deepEqual(resolved.rows[0]?.subcategoryIds, ["s1"]);
  });
});
