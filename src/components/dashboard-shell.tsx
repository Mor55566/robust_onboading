import Link from "next/link";
import type { Dictionary } from "@/i18n/dictionaries/en";
import type { SessionUser } from "@/lib/types";
import { ComplexHeaderSelect } from "@/components/complex-header-select";
import { LogoutButton } from "@/components/logout-button";
import { NavUploadStatusDot } from "@/components/nav-upload-status-dot";

export type OnboardingSection =
  | "super-admin"
  | "building"
  | "scheduled-missions"
  | "categories"
  | "documents"
  | "residents"
  | "users";

function navItems(dict: Dictionary): { key: OnboardingSection; href: string; label: string }[] {
  return [
    { key: "building", href: "/building", label: dict.profile.tabBuilding },
    { key: "categories", href: "/categories", label: dict.profile.tabCategories },
    { key: "super-admin", href: "/super-admin", label: dict.profile.tabSuperAdmin },
    { key: "scheduled-missions", href: "/scheduled-missions", label: dict.profile.tabScheduledMissions },
    { key: "documents", href: "/documents", label: dict.profile.tabFiles },
    { key: "residents", href: "/residents", label: dict.profile.tabResidents },
    { key: "users", href: "/users", label: dict.profile.tabUsers },
  ];
}

export function DashboardShell({
  dict,
  user,
  active,
  title,
  subtitle,
  children,
}: {
  dict: Dictionary;
  user: SessionUser;
  active: OnboardingSection;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const items = navItems(dict);

  return (
    <div className="flex min-h-[100dvh]">
      <aside className="hidden w-64 shrink-0 flex-col border-l bg-[var(--surface)] lg:flex">
        <div className="flex items-center gap-2.5 border-b px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand)]">
            R
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{dict.brand} Onboarding</p>
            <p className="truncate text-xs text-[var(--text-muted)]">אונבורדינג בניינים</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                item.key === active
                  ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
              }`}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <NavUploadStatusDot section={item.key} />
            </Link>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 truncate px-2 text-xs text-[var(--text-muted)]" dir="ltr">
            {user.email}
          </div>
          <LogoutButton label={dict.profile.logout} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b bg-[var(--surface)] px-4 py-3 lg:hidden">
          <p className="text-sm font-semibold">{dict.brand} Onboarding</p>
          <LogoutButton label={dict.profile.logout} />
        </header>

        <div className="flex items-center gap-3 border-b bg-[var(--surface)] px-4 py-2.5 sm:px-6">
          <ComplexHeaderSelect />
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b bg-[var(--surface)] px-3 py-2 lg:hidden">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                item.key === active
                  ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {item.label}
              <NavUploadStatusDot section={item.key} />
            </Link>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-5xl space-y-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{subtitle}</p>
              ) : null}
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
