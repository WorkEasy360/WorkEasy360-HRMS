/**
 * Typed access to the design tokens for code that needs a value in JS — chart
 * series, inline SVG fills, a computed bar width.
 *
 * These are `var(--we-*)` references, never literals: tokens.css holds the one
 * copy of every value, so nothing here can drift from it or miss dark mode.
 * If a token is missing, add it to tokens.css and name it here.
 */

const token = (name: string) => `var(--we-${name})`;

export const color = {
  logo: token("logo"),

  primary: token("primary"),
  primaryHover: token("primary-hover"),
  onPrimary: token("on-primary"),
  onPrimaryMuted: token("on-primary-muted"),

  accent: token("accent"),
  accentHover: token("accent-hover"),
  onAccent: token("on-accent"),
  accentSoft: token("accent-soft"),
  accentStrong: token("accent-strong"),

  background: token("background"),
  surface: token("surface"),
  surfaceMuted: token("surface-muted"),

  border: token("border"),
  borderStrong: token("border-strong"),
  borderInput: token("border-input"),

  textPrimary: token("text-primary"),
  textBody: token("text-body"),
  textSecondary: token("text-secondary"),
  link: token("link"),
  focus: token("focus"),

  success: token("success"),
  successSoft: token("success-soft"),
  successText: token("success-text"),
  info: token("info"),
  infoSoft: token("info-soft"),
  infoText: token("info-text"),
  warning: token("warning"),
  warningSoft: token("warning-soft"),
  warningText: token("warning-text"),
  error: token("error"),
  errorSoft: token("error-soft"),
  errorText: token("error-text"),
  onError: token("on-error"),
  ai: token("ai"),
  aiSoft: token("ai-soft"),
  aiText: token("ai-text"),

  /** Star ratings only. Never a chart series. */
  rating: token("rating"),
} as const;

/**
 * Chart series in their fixed order: navy-blue, green, violet. A fourth series
 * folds into "Other" rather than taking a new colour.
 */
export const CHART_SERIES = [token("chart-1"), token("chart-2"), token("chart-3")] as const;

export const CHART_OTHER = token("text-secondary");

export const radius = {
  sm: token("radius-sm"),
  md: token("radius-md"),
  lg: token("radius-lg"),
  xl: token("radius-xl"),
  full: token("radius-full"),
} as const;

export const size = {
  sidebar: token("size-sidebar"),
  topbar: token("size-topbar"),
  control: token("size-control"),
  controlSm: token("size-control-sm"),
  navItem: token("size-nav-item"),
  icon: token("size-icon"),
  page: token("size-page"),
  pageNarrow: token("size-page-narrow"),
} as const;

export const motion = {
  fast: token("motion-fast"),
  drawer: token("motion-drawer"),
  ease: token("motion-ease"),
} as const;

/** The tones every badge, alert and progress bar can take. */
export type Tone = "success" | "warning" | "danger" | "info" | "brand" | "ai";
