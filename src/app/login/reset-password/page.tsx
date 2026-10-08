import { AuthCard } from "@/components/auth-card";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getDictionary } from "@/i18n/get-dictionary";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [dict, query] = await Promise.all([getDictionary(), searchParams]);
  const token = query.token ?? "";

  return (
    <AuthCard title={dict.login.resetPasswordTitle} subtitle={dict.login.resetPasswordHint}>
      {token ? (
        <ResetPasswordForm dict={dict} token={token} />
      ) : (
        <p className="banner-error" role="alert">
          {dict.errors.resetLinkInvalid}
        </p>
      )}
    </AuthCard>
  );
}
