import { DashboardShell } from "@/components/dashboard-shell";
import { SuperAdminPanels } from "@/components/super-admin-panels";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function SuperAdminPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="super-admin"
      title={dict.profile.tabSuperAdmin}
    >
      <SuperAdminPanels dict={dict} />
    </DashboardShell>
  );
}
