/**
 * The product name and the brand mark.
 *
 * Per product: `PRODUCT_NAME` is the only thing that changes. Lockups show
 * "Workeasy" with the product name beneath it.
 */
export const PRODUCT_NAME = "HRMS";

/**
 * The brand mark, in the logo green. That green is for the mark only, never
 * for UI — UI green is `--we-accent`.
 *
 * This is a geometric stand-in: replace the paths with the vector traced from
 * `assets/logo.jpg` when the artwork is available, keeping the fill token.
 */
export function BrandMark({ className = "size-8", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="32" height="32" rx="8" fill="var(--we-logo)" />
      <path
        d="M8 12.5 12.2 22h1.6L16 16.4l2.2 5.6h1.6L24 12.5"
        fill="none"
        stroke="var(--we-on-accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The full lockup: the mark, "Workeasy", and the product name beneath it.
 * `onDark` is for navy surfaces such as the sidebar.
 */
export function Lockup({ onDark = false, className = "" }: { onDark?: boolean; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`text-base font-semibold ${onDark ? "text-on-navy" : "text-heading"}`}>Workeasy</span>
        <span className={`text-xs font-medium ${onDark ? "text-on-navy-muted" : "text-secondary"}`}>{PRODUCT_NAME}</span>
      </span>
    </span>
  );
}
