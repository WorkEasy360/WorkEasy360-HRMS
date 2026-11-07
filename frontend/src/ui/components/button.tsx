import { Loader2, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * `success` is kept as an alias of `primary`: the design system has one green
 * fill, and one primary button per view.
 */
type ButtonVariant = "primary" | "secondary" | "dark" | "danger" | "ghost" | "success";
type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "c-btn-primary",
  success: "c-btn-primary",
  secondary: "c-btn",
  dark: "c-btn-dark",
  danger: "c-btn-danger",
  ghost: "c-btn-ghost",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon,
  className = "",
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
}) {
  const classes = [
    VARIANT_CLASS[variant],
    size === "sm" ? "c-btn-sm" : "",
    children == null || children === false ? "c-btn-icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...props} disabled={disabled || loading} className={classes}>
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="size-4" strokeWidth={2} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

/** A square icon-only button. Always give it an aria-label. */
export function IconButton({
  size = "md",
  className = "",
  icon: Icon,
  ...props
}: ComponentProps<"button"> & { size?: ButtonSize; icon: LucideIcon }) {
  return (
    <button {...props} className={`c-btn-ghost c-btn-icon ${size === "sm" ? "c-btn-sm" : ""} ${className}`}>
      <Icon className="size-icon" strokeWidth={2} aria-hidden />
    </button>
  );
}
