import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "../tokens";

/**
 * The page contract, step 1: a centred 1200px container. `narrow` keeps the
 * same left edge and caps the content at 880px.
 */
export function Page({
  narrow = false,
  className = "",
  children,
}: {
  narrow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`c-page ${className}`} data-narrow={narrow || undefined}>
      {children}
    </div>
  );
}

/**
 * Step 2: the page header. The primary action sits at the right edge.
 *
 * `description` is accepted as an older name for `subtitle`.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const sub = subtitle ?? description;
  return (
    <div className="c-page-header">
      <div className="min-w-0">
        {eyebrow && <p className="c-eyebrow">{eyebrow}</p>}
        <h1 className="c-title">{title}</h1>
        {sub && <p className="c-subtitle">{sub}</p>}
      </div>
      {actions && <div className="c-toolbar">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`c-section-title ${className}`}>{children}</h2>;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`c-card ${className}`}>{children}</div>;
}

export function CardHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="c-card-header">
      <p className="c-card-title">{title}</p>
      {actions}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`c-card-body ${className}`}>{children}</div>;
}

/**
 * The colour a stat's number can take. The label always says what the number
 * is, so the colour is never the only signal.
 */
export type ValueTone = "warning" | "success" | "danger" | "info" | "muted";

const VALUE_TONE_CLASS: Record<ValueTone, string> = {
  warning: "text-warning",
  success: "text-success",
  danger: "text-danger-text",
  info: "text-info",
  muted: "text-secondary",
};

/** One number in a `.c-stats` row. Values use tabular numerals. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  valueTone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  valueTone?: ValueTone;
}) {
  return (
    <div className="c-stat">
      <div className="flex items-center justify-between gap-2">
        <p className="c-stat-label">{label}</p>
        {Icon && <Icon className="size-icon text-secondary" strokeWidth={2} aria-hidden />}
      </div>
      <p className={`c-stat-value ${valueTone ? VALUE_TONE_CLASS[valueTone] : ""}`}>{value}</p>
      {hint &&
        (tone ? (
          <span className="c-badge self-start" data-tone={tone}>
            {hint}
          </span>
        ) : (
          <p className="c-stat-hint">{hint}</p>
        ))}
    </div>
  );
}

/** Step 5: what a page shows before there is data. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  actions?: ReactNode;
}) {
  const buttons = actions ?? action;
  return (
    <div className="c-empty">
      {Icon && (
        <div className="c-empty-icon">
          <Icon className="size-5" strokeWidth={2} aria-hidden />
        </div>
      )}
      <p className="c-empty-title">{title}</p>
      {description && <p className="c-empty-body">{description}</p>}
      {buttons && <div className="mt-4 c-toolbar justify-center">{buttons}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="c-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Alert({
  tone,
  icon: Icon,
  children,
  className = "",
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`c-alert ${className}`} data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon strokeWidth={2} aria-hidden />}
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Progress({ value, tone, label }: { value: number; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="c-progress"
      data-tone={tone}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`c-skeleton ${className}`} />;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="c-alert" data-tone="danger">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="c-link text-xs">
          Dismiss
        </button>
      )}
    </div>
  );
}
