import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getDictionary } from "@/i18n/get-dictionary";

export default async function ForgotPasswordPage() {
  const dict = await getDictionary();

  return (
    <AuthCard title={dict.login.forgotPasswordTitle} subtitle={dict.login.forgotPasswordHint}>
      <ForgotPasswordForm dict={dict} />
    </AuthCard>
  );
}
