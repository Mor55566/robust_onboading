/**
 * Client for missions_cron's API — the same service with_robust_app uses to
 * spawn missions (with_robust_app/src/lib/missions-cron.ts), so a mission's
 * checklists are copied from its template by one implementation everywhere.
 */

function getMissionsCronApiUrl(): string {
  const raw = process.env.MISSIONS_CRON_API_URL?.trim();
  if (!raw) throw new Error("MISSIONS_CRON_API_URL is not configured");
  try {
    new URL(raw);
  } catch {
    throw new Error(
      `MISSIONS_CRON_API_URL is not a valid URL (got ${JSON.stringify(raw)}) - check for stray whitespace or embedded newlines in the env var/secret value`,
    );
  }
  return raw.replace(/\/+$/, "");
}

function getMissionsCronServiceSecret(): string {
  const secret = process.env.MISSIONS_CRON_SERVICE_SECRET?.trim();
  if (!secret) throw new Error("MISSIONS_CRON_SERVICE_SECRET is not configured");
  return secret;
}

export type SyncTemplateChecklistsResult =
  | { copied: boolean; filledLocations: number }
  | { error: string };

/**
 * missions_cron's `/api/missions/sync-template-checklists`: gives an existing
 * mission its template's checklists (the same copy as every spawn), or — when
 * it already has them — fills in the equipment / Visitt label its stops lack,
 * keeping every answer.
 */
export async function syncTemplateChecklistsViaApi(
  missionId: string,
  templateId: string,
): Promise<SyncTemplateChecklistsResult> {
  let response: Response;
  try {
    response = await fetch(`${getMissionsCronApiUrl()}/api/missions/sync-template-checklists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Missions-Cron-Service-Secret": getMissionsCronServiceSecret(),
      },
      body: JSON.stringify({ missionId, templateId }),
      cache: "no-store",
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "missions_cron_unreachable" };
  }

  const body = (await response.json().catch(() => null)) as
    | { copied?: boolean; filledLocations?: number; error?: string }
    | null;
  if (!response.ok) {
    return { error: body?.error ?? `missions_cron_${response.status}` };
  }
  return { copied: Boolean(body?.copied), filledLocations: Number(body?.filledLocations ?? 0) };
}
