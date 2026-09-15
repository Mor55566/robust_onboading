import { DashboardShell } from "@/components/dashboard-shell";
import { ScheduledMissionsUploadPanels } from "@/components/scheduled-missions-upload-panels";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function ScheduledMissionsPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="scheduled-missions"
      title={dict.profile.tabScheduledMissions}
    >
      <ScheduledMissionsUploadPanels dict={dict} />
    </DashboardShell>
  );
}
