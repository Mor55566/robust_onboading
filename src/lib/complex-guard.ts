// New for robust_onboading. Several of with_robust_app's ported super-admin
// import actions resolve a "building" (or, for mission history, a template
// mission) referenced BY NAME in the uploaded file against every building in
// the whole system — not just the complex currently selected in this app's
// header (see src/app/actions/super-admin.ts's importFloorsAction,
// importAreasForSuperAdminAction, importTasksAction,
// importScheduledMissionsAction, importMissionHistoryAction, and
// src/app/actions/admin-shared.ts's importEquipmentAction). That's fine when
// the name only exists in the intended complex, but if the same (or a
// prefix/suffix-matching) name also exists in a DIFFERENT complex, the
// ported code could silently resolve to the wrong one.
//
// Rather than re-implement each action's own fuzzy-matching algorithm
// (several slightly different normalizers), this module answers a narrower,
// safer question: "does this name look like it belongs to some OTHER
// complex, not the one selected?" A match here means the upload should be
// blocked before calling the real action; no match doesn't guarantee the
// name is valid — the real action's own "not found" handling still applies.

export function normalizeForComplexGuard(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export type NamedEntity = { name: string; complexId: string | null };

/**
 * Given a name referenced in an uploaded row and the full system-wide
 * directory of named entities (buildings, or mission-template titles) with
 * their owning complex, returns the directory entries whose name matches
 * (exactly, or as a "<name> / ..." prefix in either direction — the same
 * shape with_robust_app's own building-name matching uses) but which belong
 * to a complex OTHER than the expected one.
 */
export function findOtherComplexMatches(
  referencedName: string,
  directory: NamedEntity[],
  expectedComplexId: string,
): NamedEntity[] {
  const candidate = normalizeForComplexGuard(referencedName);
  if (!candidate) return [];

  const matches: NamedEntity[] = [];
  for (const entity of directory) {
    if (entity.complexId === expectedComplexId) continue;
    const name = normalizeForComplexGuard(entity.name);
    if (!name) continue;
    if (
      name === candidate ||
      candidate.startsWith(`${name} /`) ||
      name.startsWith(`${candidate} /`) ||
      candidate.startsWith(`${name} `) ||
      candidate.endsWith(` ${name}`)
    ) {
      matches.push(entity);
    }
  }
  return matches;
}

/**
 * Checks every name in `referencedNames` (deduplicated) against the
 * directory, returning a short, human-readable list of problem descriptions
 * for any name that matches a building/template belonging to a different
 * complex. An empty array means the check found nothing to block.
 */
export const GUARD_NOT_READY_MESSAGE =
  "בודקים שהנתונים שייכים למתחם הנכון… נסו שוב בעוד רגע.";

export function formatGuardBlockError(issues: string[]): string {
  return `הייבוא נחסם כדי למנוע ערבוב בין מתחמים:\n${issues.join("\n")}`;
}

export function findCrossComplexIssues(
  referencedNames: (string | null | undefined)[],
  directory: NamedEntity[],
  expectedComplexId: string,
): string[] {
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const raw of referencedNames) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const otherMatches = findOtherComplexMatches(name, directory, expectedComplexId);
    if (otherMatches.length > 0) {
      issues.push(`"${name}" תואם לרשומה קיימת במתחם אחר, לא במתחם שנבחר.`);
    }
  }
  return issues;
}
