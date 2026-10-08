import { AuthCard } from "@/components/auth-card";
import { PasswordLoginForm } from "@/components/password-login-form";
import { getDictionary } from "@/i18n/get-dictionary";
import { safeQrReturnPath } from "@/lib/native-app";

export default async function PasswordLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const query = await searchParams;
  const next = safeQrReturnPath(query.next);
  const dict = await getDictionary();

  return (
    <AuthCard title={dict.brand} subtitle={dict.login.passwordSubtitle}>
      <PasswordLoginForm dict={dict} next={next} />
    </AuthCard>
  );
}
