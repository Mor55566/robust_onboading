import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseResidentUsersImportContent } from "@/lib/resident-user-import";

describe("tenant users CSV import", () => {
  it("parses the Visitt tenant-contacts export", () => {
    const csv =
      '﻿"דייר","שם","תפקיד","אימייל","טלפון"\r\n' +
      '"דייר א","ישראל ישראלי","עובד/ת","israel@example.com","\'+972501234567"\r\n' +
      '"דייר ב","רונית - דייר ב","מנהל/ת דייר","","\'+972521234567"';
    const result = parseResidentUsersImportContent(csv, "tenant-users.csv");
    assert.ok("rows" in result);
    assert.deepEqual(result.rows, [
      {
        rowNumber: 2,
        resident: "דייר א",
        name: "ישראל ישראלי",
        role: "עובד/ת",
        email: "israel@example.com",
        phone: "+972501234567",
      },
      {
        rowNumber: 3,
        resident: "דייר ב",
        name: "רונית - דייר ב",
        role: "מנהל/ת דייר",
        email: "",
        phone: "+972521234567",
      },
    ]);
  });

  it("rejects a row without a tenant", () => {
    const csv = "tenant,name\n,Someone";
    const result = parseResidentUsersImportContent(csv, "tenant-users.csv");
    assert.deepEqual(result, { error: "invalidRow", message: "__row__:2" });
  });

  it("rejects an invalid email", () => {
    const csv = "tenant,name,email\nA,Someone,not-an-email";
    const result = parseResidentUsersImportContent(csv, "tenant-users.csv");
    assert.ok("error" in result);
  });

  it("requires the tenant and name columns", () => {
    const result = parseResidentUsersImportContent("name\nSomeone", "x.csv");
    assert.deepEqual(result, { error: "invalid" });
  });
});
