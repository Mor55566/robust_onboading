import { DashboardShell } from "@/components/dashboard-shell";
import { FilesUploadPanels } from "@/components/files-upload-panels";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function DocumentsPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="documents"
      title={dict.profile.tabFiles}
    >
      <FilesUploadPanels dict={dict} />
    </DashboardShell>
  );
}
