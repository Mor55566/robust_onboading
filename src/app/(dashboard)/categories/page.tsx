import { CategoriesUploadPanels } from "@/components/categories-upload-panels";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDictionary } from "@/i18n/get-dictionary";
import { requireSuperAdmin } from "@/lib/auth";

export default async function CategoriesPage() {
  const [user, dict] = await Promise.all([requireSuperAdmin(), getDictionary()]);

  return (
    <DashboardShell
      dict={dict}
      user={user}
      active="categories"
      title={dict.profile.tabCategories}
    >
      <CategoriesUploadPanels dict={dict} />
    </DashboardShell>
  );
}
