"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { errorMessage } from "@/components/feedback";
import { Button, ErrorBanner } from "@/components/ui";
import { apiFetch } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const last = localStorage.getItem("lastOrganizationSlug");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved preference on mount
      if (last) setOrganizationSlug(last);
    } catch {}
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ organizationSlug: organizationSlug.trim().toLowerCase(), email: email.trim() }),
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const back = (
    <Link href="/login" className="flex items-center justify-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="h-4 w-4" /> Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="If that account exists, a reset link is on its way.">
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
            <MailCheck className="h-5 w-5 shrink-0 text-blue-600" />
            <p>
              We sent a link to <strong>{email}</strong>. It works once and expires in 1 hour. Don&apos;t see it? Check your spam
              folder, or ask your HR admin to reset your password.
            </p>
          </div>
          {back}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your details and we'll email you a link to choose a new one.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="org" className="label">Organization ID</label>
          <input
            id="org"
            required
            autoCapitalize="none"
            spellCheck={false}
            value={organizationSlug}
            onChange={(e) => setOrganizationSlug(e.target.value)}
            placeholder="acme"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="email" className="label">Work email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="input"
          />
        </div>
        <ErrorBanner message={error} />
        <Button type="submit" loading={submitting} className="w-full">
          Send reset link
        </Button>
        {back}
      </form>
    </AuthShell>
  );
}
