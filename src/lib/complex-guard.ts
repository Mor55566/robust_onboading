// New for robust_onboading. Client-side, defense-in-depth check that runs
// before the building / mission-template import actions. Those actions now
// receive the selected complex and scope every lookup (buildings, floors,
// areas, equipment, categories, users, existing rows by external_id / call
// number) to it on the server, so a row can no longer resolve to another
// complex's data. This module still blocks an upload early, with a clear
// message, when a referenced name looks like it belongs to a DIFFERENT
// complex than the one selected — usually a sign the wrong file or the
// wrong complex was picked.
//
// It answers a narrow question: "does this name look like it belongs to some
// OTHER complex?" No match doesn't guarantee the name is valid — the real
// action's own "not found" handling still applies.

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
