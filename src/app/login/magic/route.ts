import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLinkToken, createSession } from "@/lib/auth";
import { postLoginPath } from "@/lib/native-app";
import { isSuperAdminUserId } from "@/lib/onboarding-auth";

// Based on with_robust_app's src/app/login/magic/route.ts, with an added
// super-admin gate before createSession() — see src/lib/onboarding-auth.ts.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token.length > 200) {
    return NextResponse.redirect(new URL("/login?magic=invalid", request.url));
  }

  const userId = await consumeMagicLinkToken(token);
  if (!userId || !(await isSuperAdminUserId(userId))) {
    return NextResponse.redirect(new URL("/login?magic=invalid", request.url));
  }

  await createSession(userId);
  const next = postLoginPath(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(next, request.url));
}
