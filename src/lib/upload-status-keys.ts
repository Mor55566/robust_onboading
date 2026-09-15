// Shared between server-side status queries (src/lib/upload-status.ts) and
// client components (nav dots, upload card badges) — kept free of any DB
// imports so it's safe to pull into client bundles.

export const UPLOAD_STATUS_KEYS = [
  "floors",
  "areas",
  "equipment",
  "categories",
  "fileTags",
  "files",
  "fileAttachments",
  "residents",
  "scheduledMissions",
  "missionHistory",
  "users",
  "tasks",
  "automations",
] as const;

export type UploadStatusKey = (typeof UPLOAD_STATUS_KEYS)[number];

export type UploadStatus = Record<UploadStatusKey, boolean>;

export function emptyUploadStatus(): UploadStatus {
  return Object.fromEntries(
    UPLOAD_STATUS_KEYS.map((key) => [key, false]),
  ) as UploadStatus;
}

// Which upload keys must all have at least one record for a nav tab to show
// as "done". Tabs not listed here have no per-tab indicator.
export const SECTION_UPLOAD_KEYS: Record<string, UploadStatusKey[]> = {
  building: ["floors", "areas", "equipment"],
  categories: ["categories"],
  "super-admin": ["tasks", "automations"],
  "scheduled-missions": ["scheduledMissions", "missionHistory"],
  documents: ["fileTags", "files", "fileAttachments"],
  residents: ["residents"],
  users: ["users"],
};

// Internal Robust email domains (and lookalikes) used for our own test/staff
// accounts. Users on these domains don't count toward a complex's "users
// uploaded" status, since they're not real customer users.
export const INTERNAL_EMAIL_DOMAINS = ["rebuild", "robust", "withrobust"];

export function isInternalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_EMAIL_DOMAINS.some(
    (d) => domain === d || domain.startsWith(`${d}.`),
  );
}
