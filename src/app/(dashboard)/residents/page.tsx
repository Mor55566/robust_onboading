import { DashboardShell } from "@/components/dashboard-shell";
import { ResidentsUploadPanels } from "@/components/residents-upload-panels";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function ResidentsPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="residents"
      title={dict.profile.tabResidents}
    >
      <ResidentsUploadPanels dict={dict} />
    </DashboardShell>
  );
}
