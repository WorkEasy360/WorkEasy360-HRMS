import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

if (isProduction && process.env.NEXT_PHASE === "phase-production-build" && apiUrl.includes("localhost")) {
  // NEXT_PUBLIC_* values are baked in at build time, so a missing value would ship a broken site.
  console.warn(`\n⚠  NEXT_PUBLIC_API_URL is "${apiUrl}". Set it to your public API URL before building for production.\n`);
}

// The browser may only talk to this app and the API. Next's inline bootstrap scripts need
// 'unsafe-inline' (no nonce setup); dev tooling additionally needs 'unsafe-eval'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${new URL(apiUrl).origin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Docker images set NEXT_OUTPUT=standalone for a small self-contained server; `next start` uses the default.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
