import Image from "next/image";
import logo from "../assets/logo.png";

/**
 * The product name and the brand mark.
 *
 * Per product: `PRODUCT_NAME` is the only thing that changes. The lockup is the
 * mark, the "WorkEasy360" wordmark, and the product name as a green pill.
 */
export const PRODUCT_NAME = "HRMS";

/**
 * The brand mark: the supplied artwork itself (`../assets/logo.png`, lifted off
 * its background with a real alpha channel so it sits cleanly on white and on
 * the sidebar green). `../assets/logo.jpg` is the original file it came from.
 *
 * Being an image rather than a vector, it carries its own green — the logo green,
 * the value of `--we-logo` — and cannot be recoloured by a token. That green is
 * for the mark only, never for UI; UI green is `--we-accent`.
 *
 * `unoptimized` serves the file as published: it is already sized for the slots
 * it fills, so the image optimizer would only add a round trip.
 */
export function BrandMark({ className = "size-8", title }: { className?: string; title?: string }) {
  return <Image src={logo} alt={title ?? ""} className={className} unoptimized priority aria-hidden={title ? undefined : true} />;
}

/** "WorkEasy" in the text colour, "360" in brand green. */
function Wordmark({ onDark, size }: { onDark: boolean; size: "md" | "lg" }) {
  return (
    <span className={`c-wordmark ${size === "lg" ? "c-wordmark-lg" : ""}`} data-on-dark={onDark || undefined}>
      WorkEasy<span className="c-wordmark-360">360</span>
    </span>
  );
}

/**
 * The full lockup.
 *
 * `stacked` (the sidebar): mark and wordmark, with the product pill centred
 * beneath. `inline` (sign-in): mark, wordmark, a divider, then the pill.
 * `onDark` is for the green sidebar and hero.
 */
export function Lockup({
  onDark = false,
  layout = "stacked",
  size = "md",
  className = "",
}: {
  onDark?: boolean;
  /** `plain`: mark and wordmark only, for a hero that shows the product pill on its own. */
  layout?: "stacked" | "inline" | "plain";
  size?: "md" | "lg";
  className?: string;
}) {
  const mark = <BrandMark className={size === "lg" ? "size-11" : "size-8"} />;

  if (layout === "plain") {
    return (
      <span className={`flex items-center gap-2 ${className}`}>
        {mark}
        <Wordmark onDark={onDark} size={size} />
      </span>
    );
  }

  if (layout === "inline") {
    return (
      <span className={`flex items-center gap-3 ${className}`}>
        <span className="flex items-center gap-2">
          {mark}
          <Wordmark onDark={onDark} size={size} />
        </span>
        <span aria-hidden className={`h-7 w-px ${onDark ? "bg-on-brand-muted" : "bg-line-strong"}`} />
        <span className="c-product-pill" data-size={size}>
          {PRODUCT_NAME}
        </span>
      </span>
    );
  }

  return (
    <span className={`flex flex-col items-center gap-1.5 ${className}`}>
      <span className="flex items-center gap-2">
        {mark}
        <Wordmark onDark={onDark} size={size} />
      </span>
      <span className="c-product-pill">{PRODUCT_NAME}</span>
    </span>
  );
}
