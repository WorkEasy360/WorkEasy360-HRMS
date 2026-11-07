import { Mail, KeyRound } from "lucide-react";

/** What the API returns after creating a login or resetting a password. */
export type AccessResult = { tempPassword?: string; inviteSent?: boolean; emailSent?: boolean; email?: string };

/**
 * Tells HR how the person gets in: by the emailed link (email configured) or,
 * as a fallback, a temporary password shown once to hand over privately.
 */
export function AccessNotice({ result, email, kind }: { result: AccessResult; email?: string; kind: "created" | "hired" | "reset" }) {
  const to = result.email ?? email;
  if (result.inviteSent || result.emailSent) {
    const text =
      kind === "reset"
        ? `We've emailed a password reset link${to ? ` to ${to}` : ""}. Their old password no longer works.`
        : `${kind === "hired" ? "Hired! " : "Employee created. "}We've emailed a welcome link${to ? ` to ${to}` : ""} so they can set their own password.`;
    return (
      <div className="c-alert sm:col-span-2" data-tone="success">
        <Mail strokeWidth={2} aria-hidden />
        <span>{text}</span>
      </div>
    );
  }
  if (!result.tempPassword) return null;
  return (
    <div className="c-alert sm:col-span-2" data-tone="success">
      <KeyRound strokeWidth={2} aria-hidden />
      <span>
        {kind === "hired" ? "Hired! " : kind === "created" ? "Employee created. " : ""}Share this temporary password with them privately:{" "}
        <code className="c-kbd px-1.5 py-0.5 font-mono text-heading">{result.tempPassword}</code>
        <span className="mt-1 block text-xs">It won&apos;t be shown again. They&apos;ll choose their own after signing in.</span>
      </span>
    </div>
  );
}
