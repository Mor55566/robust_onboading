import assert from "node:assert/strict";
import test from "node:test";
import { parseUsersImportContent } from "@/lib/user-import";

test("parses the default Hebrew users CSV", () => {
  const csv = "מזהה,שם,אימייל,מספר טלפון,תפקיד,תיאור תפקיד\nvisitt-user-17,ישראל ישראלי,israel@example.com,501234567,מנהל נכס,101";
  const result = parseUsersImportContent(csv, "users.csv");
  assert.ok("rows" in result);
  assert.equal(result.rows[0]?.sourceRole, "מנהל נכס");
  assert.equal(result.rows[0]?.phoneNumber, 501234567);
  assert.equal(result.rows[0]?.roleDescription, 101);
});

test("accepts optional phone and role description", () => {
  const csv = "external_id,full_name,email,role\nlegacy-42,Noa,noa@example.com,user";
  const result = parseUsersImportContent(csv, "users.csv");
  assert.ok("rows" in result);
  assert.equal(result.rows[0]?.phoneNumber, null);
  assert.equal(result.rows[0]?.roleDescription, null);
  assert.equal(result.rows[0]?.externalId, "legacy-42");
});

test("skips rows without an email", () => {
  const csv = [
    "מזהה,שם,אימייל,תפקיד",
    "user-without-email,ללא אימייל,,משתמש",
    "user-with-email,נועה,noa@example.com,משתמש",
  ].join("\n");
  const result = parseUsersImportContent(csv, "users.csv");
  assert.ok("rows" in result);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.externalId, "user-with-email");
});

test("returns empty when every row has no email", () => {
  const csv = "מזהה,שם,אימייל,תפקיד\nuser-without-email,ללא אימייל,,משתמש";
  const result = parseUsersImportContent(csv, "users.csv");
  assert.deepEqual(result, { error: "empty" });
});
