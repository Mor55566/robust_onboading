import type { ReactNode } from "react";

export function UploadCard({
  title,
  subtitle,
  buttonLabel,
  onOpen,
  disabled = false,
  done,
  children,
}: {
  title: string;
  subtitle: string;
  buttonLabel: string;
  onOpen: () => void;
  disabled?: boolean;
  /** Whether this upload's data already exists in the DB. Omit while unknown. */
  done?: boolean;
  /** Extra content rendered below the header row (e.g. a per-building status table). */
  children?: ReactNode;
}) {
  return (
    <section className="surface-card space-y-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <UploadStatusBadge done={done} />
          </div>
          <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary shrink-0"
          disabled={disabled}
          onClick={onOpen}
        >
          {buttonLabel}
        </button>
      </div>
      {disabled ? <NoComplexSelectedHint /> : null}
      {children}
    </section>
  );
}

export function BuildingUploadStatusTable({
  rows,
}: {
  rows: { id: string; name: string; count: number }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[var(--surface-muted)] text-[var(--text-muted)]">
            <th className="px-2 py-1 text-start font-medium">בניין</th>
            <th className="px-2 py-1 text-start font-medium">כמות</th>
            <th className="px-2 py-1 text-start font-medium">סטטוס</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="max-w-0 truncate px-2 py-1">{row.name}</td>
              <td className="px-2 py-1 tabular-nums">{row.count}</td>
              <td className="px-2 py-1">
                <span
                  className={
                    row.count > 0 ? "text-[var(--success)]" : "text-[var(--text-muted)]"
                  }
                >
                  {row.count > 0 ? "בוצע" : "לא בוצע"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UploadStatusBadge({ done }: { done?: boolean }) {
  if (done === undefined) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        done
          ? "bg-[var(--success-soft)] text-[var(--success)]"
          : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
      }`}
    >
      {done ? "בוצע" : "לא בוצע"}
    </span>
  );
}

export function NoComplexSelectedHint() {
  return (
    <p className="text-xs text-[var(--danger)]">
      בחרו מתחם פעיל בראש העמוד כדי להעלות נתונים.
    </p>
  );
}

export function UploadMessage({
  message,
}: {
  message: { type: "success" | "error"; text: string } | null;
}) {
  if (!message) return null;
  return (
    <p
      className={message.type === "success" ? "banner-success" : "banner-error"}
      role={message.type === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}
