import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getDictionary } from "@/i18n/get-dictionary";
import { getSession } from "@/lib/auth";

export default async function ForgotPasswordPage() {
  const user = await getSession();
  if (user) redirect("/building");

  const dict = await getDictionary();

  return (
    <AuthCard title={dict.login.forgotPasswordTitle} subtitle={dict.login.forgotPasswordHint}>
      <ForgotPasswordForm dict={dict} />
    </AuthCard>
  );
}
