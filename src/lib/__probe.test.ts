import { readFileSync } from "node:fs";
import { parseMissionHistoryImportContent } from "@/lib/mission-history-import";
const content = readFileSync("1.csv", "utf8");
const r = parseMissionHistoryImportContent(content, "1.csv");
if ("error" in r) { console.log("ERR", r); } else {
  console.log("rows", r.rows.length);
  let items = 0; const types: Record<string, number> = {}; let empty = 0; const noLoc: string[] = []; const weird: string[] = [];
  for (const row of r.rows) {
    if (row.checklistItems.length === 0) empty++;
    for (const it of row.checklistItems) { items++; types[it.itemType] = (types[it.itemType] ?? 0) + 1;
      if (!it.location) noLoc.push(row.externalId);
      if (it.label.length > 150 || it.label.includes("\n") || !it.rawValue) weird.push(JSON.stringify({id: row.externalId, label: it.label.slice(0,200), v: it.rawValue}));
    }
  }
  console.log({items, types, empty, noLoc: noLoc.length});
  console.log("weird", weird.length); console.log(weird.filter(w=>!w.includes("פאזה")).slice(0,40).join("\n"));
  console.log(JSON.stringify(r.rows[1], null, 1).slice(0, 2500));
}
