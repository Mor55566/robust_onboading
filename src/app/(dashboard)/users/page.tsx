import { DashboardShell } from "@/components/dashboard-shell";
import { UsersUploadPanels } from "@/components/users-upload-panels";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function UsersPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="users"
      title={dict.profile.tabUsers}
    >
      <UsersUploadPanels dict={dict} />
    </DashboardShell>
  );
}
