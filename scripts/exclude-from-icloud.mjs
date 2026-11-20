#!/usr/bin/env node
// This project lives under ~/Documents, which macOS syncs to iCloud Drive.
// iCloud evicts ("optimizes") rarely-read files to the cloud, leaving dataless
// placeholders. When Node/Next read them they block waiting for a download,
// so `npm start` / `npm run dev` hang forever with no output.
//
// Fix: mark node_modules and .next with the `com.apple.fileprovider.ignore#P`
// extended attribute, which tells iCloud Drive not to sync (or evict) them.
// (Symlinking to `*.nosync` folders doesn't work: Turbopack resolves the real
// path and stops treating node_modules as dependencies.)
// `npm ci` and `next build` recreate these folders and drop the attribute, so
// this runs on postinstall and before dev/build/start.
//
// Uses only Node built-ins: it must work even when node_modules is broken.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ATTR = "com.apple.fileprovider.ignore#P";

function excludeFromICloud(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const current = execFileSync("xattr", ["-p", ATTR, dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (current === "1") return;
  } catch {}
  execFileSync("xattr", ["-w", ATTR, "1", dir]);
  console.log(`[icloud] excluded ${name} from iCloud sync`);
}

function countEvicted(dir) {
  try {
    const out = execFileSync("find", [dir + "/", "-flags", "+dataless", "-print"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30000,
    });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

excludeFromICloud("node_modules");
excludeFromICloud(".next");

const evicted = countEvicted(path.join(root, "node_modules"));
if (evicted > 0) {
  console.error(
    `\n[icloud] ${evicted} files in node_modules were offloaded to iCloud ` +
      `and will make Node hang.\nReinstall them:\n\n  rm -rf node_modules && npm ci\n`,
  );
  process.exit(1);
}
