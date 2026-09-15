export default function LoginLoading() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="size-12 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
          <div className="h-6 w-32 animate-pulse rounded bg-[var(--surface-muted)]" />
        </div>
        <div className="surface-card h-64 animate-pulse p-6" />
      </div>
    </main>
  );
}
