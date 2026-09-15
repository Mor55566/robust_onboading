import { ComplexProvider } from "@/components/complex-context";
import { requireSuperAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  const [complexRows, chainRows] = await Promise.all([
    sql`SELECT id, name FROM complexes ORDER BY name ASC`,
    sql`SELECT id, name FROM chains ORDER BY name ASC`,
  ]);

  return (
    <ComplexProvider
      initialComplexes={complexRows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
      }))}
      initialChains={chainRows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
      }))}
    >
      {children}
    </ComplexProvider>
  );
}
