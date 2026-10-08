import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/login-form";
import { getDictionary } from "@/i18n/get-dictionary";
import { getSession } from "@/lib/auth";
import { safeQrReturnPath } from "@/lib/native-app";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ magic?: string; next?: string; denied?: string }>;
}) {
  const query = await searchParams;
  const next = safeQrReturnPath(query.next);
  const user = await getSession();
  // Only super admins can use this app; anyone else stays here to sign in again.
  if (user?.role === "super_admin") redirect("/building");

  const dict = await getDictionary();

  return (
    <AuthCard title={dict.brand} subtitle="כלי אונבורדינג לבניינים חדשים">
      <LoginForm
        dict={dict}
        magicLinkInvalid={query.magic === "invalid"}
        denied={query.denied === "1" || Boolean(user)}
        next={next}
      />
    </AuthCard>
  );
}
