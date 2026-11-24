import { DashboardShell } from "@/components/dashboard-shell";
import { UserAccessPanel } from "@/components/user-access-panel";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function UserAccessPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="user-access"
      title={dict.userAccess.title}
      subtitle={dict.userAccess.subtitle}
    >
      <UserAccessPanel dict={dict} />
    </DashboardShell>
  );
}
