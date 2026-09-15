import { BuildingUploadPanels } from "@/components/building-upload-panels";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function BuildingPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="building"
      title={dict.profile.tabBuilding}
    >
      <BuildingUploadPanels dict={dict} />
    </DashboardShell>
  );
}
