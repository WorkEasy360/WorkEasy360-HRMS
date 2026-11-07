import Image from "next/image";
import logo from "../assets/logo.png";

/**
 * The product name and the brand mark.
 *
 * Per product: `PRODUCT_NAME` is the only thing that changes. Lockups show
 * "Workeasy" with the product name beneath it.
 */
export const PRODUCT_NAME = "HRMS";

/**
 * The brand mark: the supplied artwork itself (`../assets/logo.png`, lifted off
 * its background with a real alpha channel so it sits cleanly on white and on
 * navy). `../assets/logo.jpg` is the original file it came from.
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
