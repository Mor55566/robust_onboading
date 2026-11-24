/**
 * Client for robust_form's `/forms/api/internal/seed-forms`: copies the
 * template complex's forms (published, with public links) into a newly
 * created complex and sets its {{building_name}} variable to the complex name.
 * robust_form owns the copy logic (src/lib/form-copy.ts there).
 */

function getFormsApiUrl(): string {
  const raw = process.env.FORMS_INTERNAL_URL?.trim();
  if (!raw) throw new Error("FORMS_INTERNAL_URL is not configured");
  try {
    new URL(raw);
  } catch {
    throw new Error(`FORMS_INTERNAL_URL is not a valid URL (got ${JSON.stringify(raw)})`);
  }
  return raw.replace(/\/+$/, "");
}

function getFormsOnboardingSecret(): string {
  const secret = process.env.FORMS_ONBOARDING_SECRET?.trim();
  if (!secret) throw new Error("FORMS_ONBOARDING_SECRET is not configured");
  return secret;
}

/** Returns how many forms were created. Throws on failure; callers treat it as best-effort. */
export async function seedFormsForComplex(complexId: string, complexName: string, userId: string): Promise<number> {
  const response = await fetch(`${getFormsApiUrl()}/forms/api/internal/seed-forms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forms-Onboarding-Secret": getFormsOnboardingSecret(),
    },
    body: JSON.stringify({ complexId, complexName, userId }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.json().catch(() => null)) as { created?: number; error?: string } | null;
  if (!response.ok) throw new Error(`seed-forms failed (${response.status}): ${body?.error ?? "unknown error"}`);
  return Number(body?.created ?? 0);
}
