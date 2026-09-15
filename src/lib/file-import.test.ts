import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloudinaryPublicIdFromSource,
  isArchivedImportedResident,
  isCloudinaryStorageUrl,
  isCopyableImageAttachment,
  isUnlinkedImportedResident,
  normalizeImportedResidentName,
  parseFileAttachmentNotCloudinaryMessage,
  parseFileAttachmentsImportContent,
  parseFilesImportContent,
  resolveFileAttachmentImportRows,
  resolveFileImportRows,
  type ExistingFileSeries,
  type FileImportRow,
} from "@/lib/file-import";

function fileRow(
  overrides: Partial<FileImportRow> & Pick<FileImportRow, "externalId" | "title">,
): FileImportRow {
  return {
    rowNumber: 2,
    complex: "Complex A",
    tag: "",
    resident: "",
    ...overrides,
  };
}

function existingSeries(
  overrides: Partial<ExistingFileSeries> & Pick<ExistingFileSeries, "id">,
): ExistingFileSeries {
  return {
    complex_id: "complex-1",
    title: null,
    external_id: null,
    ...overrides,
  };
}

describe("resident name helpers", () => {
  it("removes the resident prefix from Hebrew CSV values", () => {
    assert.equal(normalizeImportedResidentName("דייר - אנבידיה"), "אנבידיה");
    assert.equal(normalizeImportedResidentName("דייר – [אנבידיה]"), "אנבידיה");
  });

  it("recognizes archived resident values", () => {
    assert.equal(
      isArchivedImportedResident("דייר - אינבידיה (בארכיון)"),
      true,
    );
    assert.equal(isArchivedImportedResident("דייר - אינבידיה"), false);
  });

  it("treats אין ישויות מקושרות as no resident", () => {
    assert.equal(isUnlinkedImportedResident("אין ישויות מקושרות"), true);
    assert.equal(isUnlinkedImportedResident("  אין   ישויות מקושרות  "), true);
    assert.equal(isUnlinkedImportedResident("דייר - אנבידיה"), false);
  });
});

describe("file series import (documents CSV, series-only)", () => {
  const complexes = [{ id: "complex-1", name: "Complex A" }];

  it("parses an optional tag column onto the series import row", () => {
    const parsed = parseFilesImportContent(
      "#,מזהה,נכס,שם,תגית\n1,visitt-42,Complex A,Insurance,חוזים\n",
      "files.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;
    assert.equal(parsed.rows[0]?.externalId, "visitt-42");
    assert.equal(parsed.rows[0]?.tag, "חוזים");
  });

  it("parses שייך מסמך ל onto the series import row", () => {
    const parsed = parseFilesImportContent(
      "#,מזהה,נכס,שם,תגית,שייך מסמך ל\n1,visitt-42,Complex A,Insurance,חוזים,דייר - מנדיי\n",
      "files.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;
    assert.equal(parsed.rows[0]?.resident, "דייר - מנדיי");
  });

  it("creates a new series and keeps the template id as external id", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-42", title: "Insurance" })],
      complexes,
      existing: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "create");
    assert.equal(item.externalId, "visitt-42");
    assert.equal(item.title, "Insurance");
  });

  it("matches an existing series by external id even if the title changed", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-42", title: "Insurance 2026" })],
      complexes,
      existing: [
        existingSeries({
          id: "series-1",
          title: "Insurance 2025",
          external_id: "visitt-42",
        }),
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "update");
    assert.equal(item.id, "series-1");
    assert.equal(item.externalId, "visitt-42");
    assert.equal(item.title, "Insurance 2026");
  });

  it("claims a unique title match when the existing series has no external id", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-42", title: "Insurance" })],
      complexes,
      existing: [
        existingSeries({
          id: "series-1",
          title: "Insurance",
          external_id: null,
        }),
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "update");
    assert.equal(item.id, "series-1");
    assert.equal(item.externalId, "visitt-42");
  });

  it("creates a new series when two untitled-id series share the same title", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-42", title: "Insurance" })],
      complexes,
      existing: [
        existingSeries({ id: "series-1", title: "Insurance" }),
        existingSeries({ id: "series-2", title: "Insurance" }),
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "create");
    assert.equal(item.externalId, "visitt-42");
    assert.notEqual(item.id, "series-1");
    assert.notEqual(item.id, "series-2");
  });

  it("rejects a row whose complex cannot be resolved", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-1", title: "Insurance", complex: "Unknown" })],
      complexes,
      existing: [],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "complex");
    assert.equal(result.value, "Unknown");
  });

  it("saves a matching tag on the series, not a file", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-42", title: "Insurance", tag: "חוזים" })],
      complexes,
      existing: [],
      tags: [
        {
          id: "tag-1",
          complex_id: "complex-1",
          name: "חוזים",
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.tagId, "tag-1");
  });

  it("rejects a tag that does not exist in the resolved complex", () => {
    const result = resolveFileImportRows({
      rows: [fileRow({ externalId: "visitt-42", title: "Insurance", tag: "Missing" })],
      complexes,
      existing: [],
      tags: [
        {
          id: "tag-other",
          complex_id: "complex-2",
          name: "Missing",
        },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "tag");
    assert.equal(result.value, "Missing");
  });

  it("maps דייר - מנדיי to the matching complex resident", () => {
    const result = resolveFileImportRows({
      rows: [
        fileRow({
          externalId: "visitt-42",
          title: "Insurance",
          resident: "דייר - מנדיי",
        }),
      ],
      complexes,
      existing: [],
      residents: [
        {
          id: "resident-1",
          complex_id: "complex-1",
          display_name: "מנדיי",
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.residentId, "resident-1");
  });

  it("ignores an archived resident in שייך מסמך ל", () => {
    const result = resolveFileImportRows({
      rows: [
        fileRow({
          externalId: "visitt-42",
          title: "Insurance",
          resident: "דייר - אינבידיה (בארכיון)",
        }),
      ],
      complexes,
      existing: [],
      residents: [
        {
          id: "resident-1",
          complex_id: "complex-1",
          display_name: "אינבידיה",
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.residentId, null);
  });

  it("rejects a resident that does not exist in the resolved complex", () => {
    const result = resolveFileImportRows({
      rows: [
        fileRow({
          externalId: "visitt-42",
          title: "Insurance",
          resident: "דייר - מנדיי",
        }),
      ],
      complexes,
      existing: [],
      residents: [],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "resident");
    assert.equal(result.value, "דייר - מנדיי");
  });
});

const DOCUMENTS_EXPORT_CSV = `﻿external_id,title,tag_name,linked_entity,version,source,start_date,expiration_date,created_at,created_by_name,attachment_index,file_name,mime_type,storage_url
"655dbe604d69d1fff0721cdd","אישור אכלוס כבאות - אנבידיה","דיירים - אחזקה מונעת","דייר - אנבידיה","1","current","1/5/22","30/4/27","22/11/23 10:40","ישראל ישראלי","1","tuejkh7aabxfbt0ngkiq.jpeg","image/jpeg","https://res.cloudinary.com/gantzi/image/upload/tuejkh7aabxfbt0ngkiq.jpeg"
"655dbe604d69d1fff0721cdd","אישור אכלוס כבאות - אנבידיה","דיירים - אחזקה מונעת","דייר - אנבידיה","1","current","1/5/22","30/4/27","22/11/23 10:40","ישראל ישראלי","2","covjbcdm9sibbu323bbj.jpeg","image/jpeg","https://res.cloudinary.com/gantzi/image/upload/covjbcdm9sibbu323bbj.jpeg"
"655dbe604d69d1fff0721cdd","אישור אכלוס כבאות - אנבידיה","דיירים - אחזקה מונעת","דייר - אנבידיה","1","current","1/5/22","30/4/27","22/11/23 10:40","ישראל ישראלי","3","mnse5agr5xbbse91diry.jpeg","image/jpeg","https://res.cloudinary.com/gantzi/image/upload/mnse5agr5xbbse91diry.jpeg"
"655dbe604d69d1fff0721cdd","אישור אכלוס כבאות - אנבידיה","דיירים - אחזקה מונעת","דייר - אנבידיה","1","current","1/5/22","30/4/27","22/11/23 10:40","ישראל ישראלי","4","tea8kchd0hz3bbffdhfc.jpeg","image/jpeg","https://res.cloudinary.com/gantzi/image/upload/tea8kchd0hz3bbffdhfc.jpeg"
"655dbe604d69d1fff0721cdd","אישור אכלוס כבאות - אנבידיה","דיירים - אחזקה מונעת","דייר - אנבידיה","1","current","1/5/22","30/4/27","22/11/23 10:40","ישראל ישראלי","5","notes.csv","text/csv","https://res.cloudinary.com/gantzi/raw/upload/notes.csv"
`;

describe("document attachment import", () => {
  it("extracts the Cloudinary public id from a source file URL", () => {
    assert.equal(
      cloudinaryPublicIdFromSource(
        "https://res.cloudinary.com/gantzi/image/upload/kvmhd9spoznhhnjc76gh.jpeg",
      ),
      "kvmhd9spoznhhnjc76gh",
    );
    assert.equal(
      cloudinaryPublicIdFromSource(
        "https://res.cloudinary.com/gantzi/image/upload/c_scale/plfxpejgbj2atjaqsviy.jpg",
      ),
      "plfxpejgbj2atjaqsviy",
    );
    assert.equal(
      cloudinaryPublicIdFromSource("", "kvmhd9spoznhhnjc76gh.jpeg"),
      "kvmhd9spoznhhnjc76gh",
    );
  });
  it("copies image URLs and skips CSV attachment URLs", () => {
    assert.equal(
      isCopyableImageAttachment({
        mimeType: "image/jpeg",
        fileName: "photo.jpeg",
        storageUrl: "https://res.cloudinary.com/gantzi/image/upload/photo.jpeg",
      }),
      true,
    );
    assert.equal(
      isCopyableImageAttachment({
        mimeType: "text/csv",
        fileName: "notes.csv",
        storageUrl: "https://res.cloudinary.com/gantzi/raw/upload/notes.csv",
      }),
      false,
    );
    assert.equal(
      isCopyableImageAttachment({
        mimeType: "image/jpeg",
        fileName: "export.csv",
        storageUrl: "https://example.com/documents_export.csv",
      }),
      false,
    );
    assert.equal(
      isCopyableImageAttachment({
        mimeType: "image/jpeg",
        fileName: "photo.jpeg",
        storageUrl: "https://example.com/photo.jpeg",
      }),
      false,
    );
    assert.equal(
      isCloudinaryStorageUrl(
        "https://res.cloudinary.com/gantzi/image/upload/photo.jpeg",
      ),
      true,
    );
    assert.equal(isCloudinaryStorageUrl("https://example.com/photo.jpeg"), false);
  });

  it("rejects storage_url values that are not Cloudinary URLs", () => {
    const parsed = parseFileAttachmentsImportContent(
      "external_id,storage_url\n655dbe604d69d1fff0721cdd,https://example.com/photo.jpeg\n",
      "files.csv",
    );
    assert.equal("error" in parsed, true);
    if (!("error" in parsed)) return;
    assert.equal(parsed.error, "invalidRow");
    const notCloudinary = parseFileAttachmentNotCloudinaryMessage(parsed.message);
    assert.equal(notCloudinary?.row, "2");
    assert.equal(notCloudinary?.url, "https://example.com/photo.jpeg");
  });

  it("still skips CSV URLs even when they are not Cloudinary", () => {
    const parsed = parseFileAttachmentsImportContent(
      "external_id,file_name,mime_type,storage_url\n655dbe604d69d1fff0721cdd,notes.csv,text/csv,https://example.com/notes.csv\n",
      "files.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;
    assert.equal(parsed.rows[0]?.attachments.length, 0);
  });

  it("reads the series id from external_id and does not require a title", () => {
    const parsed = parseFileAttachmentsImportContent(
      "external_id,storage_url\n655dbe604d69d1fff0721cdd,https://res.cloudinary.com/gantzi/image/upload/photo.jpeg\n",
      "files.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;
    assert.equal(parsed.rows[0]?.externalId, "655dbe604d69d1fff0721cdd");
    assert.equal(parsed.rows[0]?.attachments.length, 1);
  });

  it("prefers the external_id column over מזהה", () => {
    const parsed = parseFileAttachmentsImportContent(
      "מזהה,external_id,storage_url\n,655dbe604d69d1fff0721cdd,https://res.cloudinary.com/gantzi/image/upload/photo.jpeg\n",
      "files.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;
    assert.equal(parsed.rows[0]?.externalId, "655dbe604d69d1fff0721cdd");
  });

  it("groups export rows by external id and keeps only image attachments", () => {
    const parsed = parseFileAttachmentsImportContent(
      DOCUMENTS_EXPORT_CSV,
      "documents_export.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;

    assert.equal(parsed.rows.length, 1);
    const document = parsed.rows[0]!;
    assert.equal(document.externalId, "655dbe604d69d1fff0721cdd");
    assert.equal(document.version, 1);
    assert.equal(document.startDate, "2022-05-01");
    assert.equal(document.expirationDate, "2027-04-30");
    assert.equal(document.createdAt, "2023-11-22T10:40:00+03:00");
    assert.equal(document.createdByName, "ישראל ישראלי");
    assert.equal(document.attachments.length, 4);
    assert.deepEqual(
      document.attachments.map((attachment) => attachment.externalId),
      [
        "tuejkh7aabxfbt0ngkiq",
        "covjbcdm9sibbu323bbj",
        "mnse5agr5xbbse91diry",
        "tea8kchd0hz3bbffdhfc",
      ],
    );
    assert.deepEqual(
      document.attachments.map((attachment) => attachment.fileName),
      [
        "tuejkh7aabxfbt0ngkiq.jpeg",
        "covjbcdm9sibbu323bbj.jpeg",
        "mnse5agr5xbbse91diry.jpeg",
        "tea8kchd0hz3bbffdhfc.jpeg",
      ],
    );
  });

  it("attaches images to an existing series matched by external_id", () => {
    const parsed = parseFileAttachmentsImportContent(
      DOCUMENTS_EXPORT_CSV,
      "documents_export.csv",
    );
    assert.equal("rows" in parsed, true);
    if (!("rows" in parsed)) return;

    const result = resolveFileAttachmentImportRows({
      rows: parsed.rows,
      complexId: "complex-1",
      existingSeries: [
        {
          id: "series-1",
          title: "אישור אכלוס כבאות - אנבידיה",
          external_id: "655dbe604d69d1fff0721cdd",
        },
      ],
      existingVersions: [
        {
          id: "file-latest",
          series_id: "series-1",
          version: 1,
          file_external_id: null,
        },
      ],
      tags: [
        {
          id: "tag-1",
          complex_id: "complex-1",
          name: "דיירים - אחזקה מונעת",
        },
      ],
      residents: [
        {
          id: "resident-1",
          complex_id: "complex-1",
          display_name: "אנבידיה",
        },
      ],
      users: [
        {
          id: "user-1",
          complex_id: "complex-1",
          full_name: "ישראל ישראלי",
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "update");
    assert.equal(item.seriesAction, "reuse");
    assert.equal(item.seriesId, "series-1");
    assert.equal(item.id, "file-latest");
    assert.equal(item.tagId, "tag-1");
    assert.equal(item.residentId, "resident-1");
    assert.equal(item.createdByUserId, "user-1");
    assert.equal(item.fileExternalId, "tuejkh7aabxfbt0ngkiq");
    assert.equal(item.attachments.length, 4);
  });

  it("creates a second version on the same series", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-42",
          tag: "",
          resident: "",
          version: 2,
          startDate: "2026-01-01",
          expirationDate: "2026-12-31",
          createdAt: null,
          createdByName: "",
          attachments: [
            {
              index: 1,
              fileName: "scan.jpeg",
              mimeType: "image/jpeg",
              storageUrl: "https://res.cloudinary.com/gantzi/image/upload/scan.jpeg",
              externalId: "scan",
            },
          ],
        },
      ],
      complexId: "complex-1",
      existingSeries: [{ id: "series-1", title: "Insurance", external_id: "visitt-42" }],
      existingVersions: [
        {
          id: "file-v1",
          series_id: "series-1",
          version: 1,
          file_external_id: null,
        },
      ],
      tags: [],
      residents: [],
      users: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "create");
    assert.equal(item.seriesAction, "reuse");
    assert.equal(item.seriesId, "series-1");
    assert.notEqual(item.id, "file-v1");
    assert.equal(item.version, 2);
  });

  it("rejects a row whose external_id does not match an existing series", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-99",
          tag: "",
          resident: "",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "",
          attachments: [],
        },
      ],
      complexId: "complex-1",
      existingSeries: [{ id: "series-1", title: "Insurance", external_id: "visitt-42" }],
      existingVersions: [],
      tags: [],
      residents: [],
      users: [],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "series");
    assert.equal(result.value, "visitt-99");
  });

  it("does not match a series by title", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-1",
          tag: "",
          resident: "",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "",
          attachments: [],
        },
      ],
      complexId: "complex-1",
      existingSeries: [
        { id: "series-1", title: "Insurance", external_id: "other-id" },
        { id: "series-2", title: "Insurance", external_id: "another-id" },
      ],
      existingVersions: [],
      tags: [],
      residents: [],
      users: [],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "series");
    assert.equal(result.value, "visitt-1");
  });

  it("maps created_by_name to the matching complex user id", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-42",
          tag: "",
          resident: "",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "ישראל ישראלי (ממשימה)",
          attachments: [],
        },
      ],
      complexId: "complex-1",
      existingSeries: [{ id: "series-1", title: "Insurance", external_id: "visitt-42" }],
      existingVersions: [],
      tags: [],
      residents: [],
      users: [
        {
          id: "user-1",
          complex_id: "complex-1",
          full_name: "ישראל ישראלי",
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.createdByUserId, "user-1");
  });

  it("rejects an unknown created_by_name", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-42",
          tag: "",
          resident: "",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "Unknown Person",
          attachments: [],
        },
      ],
      complexId: "complex-1",
      existingSeries: [{ id: "series-1", title: "Insurance", external_id: "visitt-42" }],
      existingVersions: [],
      tags: [],
      residents: [],
      users: [
        {
          id: "user-1",
          complex_id: "complex-1",
          full_name: "ישראל ישראלי",
        },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "user");
    assert.equal(result.value, "Unknown Person");
  });

  it("leaves the creator empty when created_by_name is blank", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-42",
          tag: "",
          resident: "",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "",
          attachments: [],
        },
      ],
      complexId: "complex-1",
      existingSeries: [{ id: "series-1", title: "Insurance", external_id: "visitt-42" }],
      existingVersions: [],
      tags: [],
      residents: [],
      users: [
        {
          id: "user-1",
          complex_id: "complex-1",
          full_name: "ישראל ישראלי",
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.createdByUserId, null);
  });

  it("imports אין ישויות מקושרות without assigning a resident", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "visitt-42",
          tag: "",
          resident: "אין ישויות מקושרות",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "",
          attachments: [],
        },
      ],
      complexId: "complex-1",
      existingSeries: [{ id: "series-1", title: "Insurance", external_id: "visitt-42" }],
      existingVersions: [],
      tags: [],
      residents: [
        {
          id: "resident-1",
          complex_id: "complex-1",
          display_name: "אנבידיה",
        },
      ],
      users: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.residentId, null);
  });

  it("updates an existing series file and skips images already stored by external id", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "655dbe604d69d1fff0721cdd",
          tag: "",
          resident: "",
          version: 1,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "",
          attachments: [
            {
              index: 1,
              fileName: "kvmhd9spoznhhnjc76gh.jpeg",
              mimeType: "image/jpeg",
              storageUrl:
                "https://res.cloudinary.com/gantzi/image/upload/kvmhd9spoznhhnjc76gh.jpeg",
              externalId: "kvmhd9spoznhhnjc76gh",
            },
            {
              index: 2,
              fileName: "new-scan.jpeg",
              mimeType: "image/jpeg",
              storageUrl:
                "https://res.cloudinary.com/gantzi/image/upload/new-scan.jpeg",
              externalId: "new-scan",
            },
          ],
        },
      ],
      complexId: "complex-1",
      existingSeries: [
        {
          id: "series-1",
          title: "Kept series title",
          external_id: "655dbe604d69d1fff0721cdd",
        },
      ],
      existingVersions: [
        {
          id: "file-latest",
          series_id: "series-1",
          version: 1,
          file_external_id: "kvmhd9spoznhhnjc76gh",
        },
      ],
      existingAttachments: [
        {
          series_id: "series-1",
          file_id: "file-latest",
          file_name: "kvmhd9spoznhhnjc76gh.jpeg",
          mime_type: "image/jpeg",
          storage_url: "https://res.cloudinary.com/ours/image/upload/kvmhd9spoznhhnjc76gh.jpeg",
          external_id: "kvmhd9spoznhhnjc76gh",
        },
      ],
      tags: [],
      residents: [],
      users: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "update");
    assert.equal(item.seriesAction, "reuse");
    assert.equal(item.id, "file-latest");
    assert.equal(item.title, "Kept series title");
    assert.equal(item.attachments[0]?.alreadyOnFile, true);
    assert.equal(item.attachments[0]?.reuse, null);
    assert.equal(item.attachments[1]?.alreadyOnFile, false);
    assert.equal(item.attachments[1]?.reuse, null);
  });

  it("reuses a file already stored on the same series without uploading again", () => {
    const result = resolveFileAttachmentImportRows({
      rows: [
        {
          rowNumber: 2,
          externalId: "655dbe604d69d1fff0721cdd",
          tag: "",
          resident: "",
          version: 2,
          startDate: null,
          expirationDate: null,
          createdAt: null,
          createdByName: "",
          attachments: [
            {
              index: 1,
              fileName: "kvmhd9spoznhhnjc76gh.jpeg",
              mimeType: "image/jpeg",
              storageUrl:
                "https://res.cloudinary.com/gantzi/image/upload/kvmhd9spoznhhnjc76gh.jpeg",
              externalId: "kvmhd9spoznhhnjc76gh",
            },
          ],
        },
      ],
      complexId: "complex-1",
      existingSeries: [
        {
          id: "series-1",
          title: "Insurance 2025",
          external_id: "655dbe604d69d1fff0721cdd",
        },
      ],
      existingVersions: [
        {
          id: "file-v1",
          series_id: "series-1",
          version: 1,
          file_external_id: "kvmhd9spoznhhnjc76gh",
        },
      ],
      existingAttachments: [
        {
          series_id: "series-1",
          file_id: "file-v1",
          file_name: "kvmhd9spoznhhnjc76gh.jpeg",
          mime_type: "image/jpeg",
          storage_url: "https://res.cloudinary.com/ours/image/upload/kvmhd9spoznhhnjc76gh.jpeg",
          external_id: "kvmhd9spoznhhnjc76gh",
        },
      ],
      tags: [],
      residents: [],
      users: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.items[0]!;
    assert.equal(item.action, "create");
    assert.equal(item.seriesAction, "reuse");
    assert.notEqual(item.id, "file-v1");
    assert.equal(item.attachments[0]?.alreadyOnFile, false);
    assert.equal(
      item.attachments[0]?.reuse?.storage_url,
      "https://res.cloudinary.com/ours/image/upload/kvmhd9spoznhhnjc76gh.jpeg",
    );
  });
});
