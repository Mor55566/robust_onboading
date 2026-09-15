const NAV_SKELETON_ITEMS = 7;

export default function DashboardLoading() {
  return (
    <div className="flex min-h-[100dvh] animate-pulse">
      <aside className="hidden w-64 shrink-0 flex-col border-l bg-[var(--surface)] lg:flex">
        <div className="flex items-center gap-2.5 border-b px-5 py-5">
          <div className="size-9 rounded-xl bg-[var(--surface-muted)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-28 rounded bg-[var(--surface-muted)]" />
            <div className="h-3 w-20 rounded bg-[var(--surface-muted)]" />
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {Array.from({ length: NAV_SKELETON_ITEMS }).map((_, index) => (
            <div key={index} className="h-9 rounded-lg bg-[var(--surface-muted)]" />
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 h-3 w-32 rounded bg-[var(--surface-muted)]" />
          <div className="h-8 w-full rounded-lg bg-[var(--surface-muted)]" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b bg-[var(--surface)] px-4 py-3 lg:hidden">
          <div className="h-4 w-32 rounded bg-[var(--surface-muted)]" />
          <div className="h-8 w-16 rounded-lg bg-[var(--surface-muted)]" />
        </header>

        <div className="flex items-center gap-3 border-b bg-[var(--surface)] px-4 py-2.5 sm:px-6">
          <div className="h-8 w-48 rounded-lg bg-[var(--surface-muted)]" />
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b bg-[var(--surface)] px-3 py-2 lg:hidden">
          {Array.from({ length: NAV_SKELETON_ITEMS }).map((_, index) => (
            <div key={index} className="h-7 w-20 shrink-0 rounded-lg bg-[var(--surface-muted)]" />
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="space-y-2">
              <div className="h-6 w-48 rounded bg-[var(--surface-muted)]" />
              <div className="h-4 w-72 rounded bg-[var(--surface-muted)]" />
            </div>
            <div className="space-y-3">
              <div className="h-32 rounded-xl bg-[var(--surface-muted)]" />
              <div className="h-32 rounded-xl bg-[var(--surface-muted)]" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
