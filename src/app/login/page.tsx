import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/login-form";
import { getDictionary } from "@/i18n/get-dictionary";
import { getSession } from "@/lib/auth";
import { safeQrReturnPath } from "@/lib/native-app";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ magic?: string; next?: string }>;
}) {
  const query = await searchParams;
  const next = safeQrReturnPath(query.next);
  const user = await getSession();
  if (user) redirect("/building");

  const dict = await getDictionary();

  return (
    <AuthCard title={dict.brand} subtitle="כלי אונבורדינג לבניינים חדשים">
      <LoginForm dict={dict} magicLinkInvalid={query.magic === "invalid"} next={next} />
    </AuthCard>
  );
}
