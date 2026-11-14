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
  icon: Icon,
  keepTitleOnPhone = false,
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** The page's menu icon, shown in a soft green tile beside the title. */
  icon?: LucideIcon;
  /** On phones the app bar names the screen; keep the title only when it says more (a person's name). */
  keepTitleOnPhone?: boolean;
}) {
  const sub = subtitle ?? description;
  return (
    <div className="c-page-header" data-phone-title={keepTitleOnPhone ? undefined : "hide"}>
      <div className="c-title-row">
        {Icon && (
          <div className="c-title-icon" aria-hidden>
            <Icon strokeWidth={2} />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="c-eyebrow">{eyebrow}</p>}
          <h1 className="c-title">{title}</h1>
          {sub && <p className="c-subtitle">{sub}</p>}
        </div>
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

/**
 * One number in a `.c-stats` row, with its icon in a tinted tile on the left.
 * Values use proportional figures at this size (see the dataviz guidance).
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  iconTone,
  tone,
  valueTone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** The tile's colour. Defaults to brand green. */
  iconTone?: "brand" | "info" | "warning" | "danger" | "ai";
  tone?: Tone;
  valueTone?: ValueTone;
}) {
  return (
    <div className="c-stat">
      {Icon && (
        <div className="c-icon-tile" data-tone={iconTone === "brand" ? undefined : iconTone} aria-hidden>
          <Icon strokeWidth={2} />
        </div>
      )}
      <div className="c-stat-body">
        <p className="c-stat-label">{label}</p>
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
    </div>
  );
}

const AVATAR_TONES = [undefined, "info", "ai", "warning", "danger"] as const;

/**
 * Initials on a tinted disc. The tone comes from the name, so the same person
 * keeps the same colour on every screen. It is decoration, never data.
 */
export function Avatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="c-avatar" data-size={size} data-tone={AVATAR_TONES[hash % AVATAR_TONES.length]} aria-hidden>
      {initials || "?"}
    </span>
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
