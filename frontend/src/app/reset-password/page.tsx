"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Loader2, LinkIcon } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { errorMessage, useFeedback } from "@/components/feedback";
import { PasswordInput, PasswordStrength, passwordIssues } from "@/components/PasswordInput";
import { Button, ErrorBanner } from "@/ui";
import { apiFetch } from "@/lib/api";

type TokenInfo = { purpose: "INVITE" | "RESET"; email: string; organizationSlug: string; organizationName: string };

/** Handles both the welcome "set your password" link and password reset links. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { toast } = useFeedback();
  // Read once on first client render (effects may run twice in development).
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("token"),
  );
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Keep the secret out of the address bar and browser history.
    window.history.replaceState(null, "", "/reset-password");
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the URL once on mount
      setLinkError("This link is missing its code. Open the link from your email again.");
      return;
    }
    apiFetch<TokenInfo>("/auth/password-token", { method: "POST", body: JSON.stringify({ token }) })
      .then(setInfo)
      .catch((err) => setLinkError(errorMessage(err)));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const issues = passwordIssues(password);
    if (issues.length) return setError(`Password still needs ${issues.join(", ")}.`);
    if (password !== confirmPassword) return setError("The passwords don't match.");
    setSubmitting(true);
    try {
      const res = await apiFetch<{ organizationSlug: string; email: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      try {
        localStorage.setItem("lastOrganizationSlug", res.organizationSlug);
      } catch {}
      toast.success("Password saved. Sign in with your new password.");
      router.replace(`/login?email=${encodeURIComponent(res.email)}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (linkError) {
    return (
      <AuthShell title="This link doesn't work" subtitle="It may have expired or already been used.">
        <div className="space-y-4">
          <div className="c-alert" data-tone="warning">
            <LinkIcon strokeWidth={2} aria-hidden />
            <p className="flex-1">{linkError}</p>
          </div>
          <Link
            href="/forgot-password"
            className="c-btn-primary w-full"
          >
            Request a new link
          </Link>
          <Link href="/login" className="block text-center text-sm text-secondary hover:text-heading">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (!info) {
    return (
      <AuthShell title="Checking your link…" subtitle="One moment.">
        <Loader2 className="h-5 w-5 animate-spin text-secondary" />
      </AuthShell>
    );
  }

  const isInvite = info.purpose === "INVITE";
  return (
    <AuthShell
      title={isInvite ? `Welcome to ${info.organizationName}` : "Choose a new password"}
      subtitle={isInvite ? "Set a password to finish setting up your account." : `For ${info.email}`}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {isInvite && (
          <div className="rounded-md bg-muted p-3 text-sm text-body">
            You&apos;ll sign in with organization ID <strong className="text-heading">{info.organizationSlug}</strong> and{" "}
            <strong className="text-heading">{info.email}</strong>.
          </div>
        )}
        <div>
          <label htmlFor="new-password" className="c-label">New password</label>
          <PasswordInput id="new-password" required autoComplete="new-password" value={password} onChange={setPassword} />
          <PasswordStrength password={password} />
        </div>
        <div>
          <label htmlFor="confirm-password" className="c-label">Confirm password</label>
          <PasswordInput id="confirm-password" required autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} />
        </div>
        <ErrorBanner message={error} />
        <Button type="submit" loading={submitting} className="w-full">
          {isInvite ? "Set password" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
