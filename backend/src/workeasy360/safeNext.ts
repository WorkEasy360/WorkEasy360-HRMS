/** A same-site path to land on after sign-in; anything else is the dashboard. */
export function safeNext(value: unknown): string {
  const fallback = "/dashboard";
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  // One leading slash, no scheme-relative "//" or "/\", no control characters, no backslashes.
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const resolved = new URL(value, "https://app.invalid");
    if (resolved.origin !== "https://app.invalid") return fallback;
    if (resolved.pathname === "/login" || resolved.pathname.startsWith("/api/")) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
