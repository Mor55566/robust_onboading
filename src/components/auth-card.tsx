export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-lg font-bold text-[var(--brand)]">
            R
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="surface-card p-6 sm:p-7">{children}</div>
      </div>
    </main>
  );
}
