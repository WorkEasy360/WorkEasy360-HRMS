"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AuthShell, safeNextPath } from "@/components/AuthShell";
import { errorMessage } from "@/components/feedback";
import { PasswordInput } from "@/components/PasswordInput";
import { Button, ErrorBanner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useAppConfig } from "@/lib/use-app-config";

const LAST_ORG_KEY = "lastOrganizationSlug";

export default function LoginPage() {
  const { user, loading, login, completeMfaLogin } = useAuth();
  const config = useAppConfig();
  const router = useRouter();
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in: skip the form.
  useEffect(() => {
    if (!loading && user) router.replace(safeNextPath());
  }, [loading, user, router]);

  // Pre-fill the organization ID used last time on this device, and the email after a password reset.
  useEffect(() => {
    const prefillEmail = new URLSearchParams(window.location.search).get("email");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring saved values on mount
    if (prefillEmail) setEmail(prefillEmail);
    try {
      const last = localStorage.getItem(LAST_ORG_KEY);
      if (last) setOrganizationSlug(last);
    } catch {
      // Storage unavailable; the user just types it.
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const slug = organizationSlug.trim().toLowerCase();
      const result = await login(slug, email.trim(), password);
      try {
        localStorage.setItem(LAST_ORG_KEY, slug);
      } catch {}
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
        setPassword("");
      } else {
        router.replace(safeNextPath());
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await completeMfaLogin(mfaToken, code);
      router.replace(safeNextPath());
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  if (mfaToken) {
    return (
      <AuthShell title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={onSubmitMfa} className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            <ShieldCheck className="h-5 w-5 shrink-0 text-blue-600" />
            Your account is protected with two-factor authentication.
          </div>
          <div>
            <label htmlFor="code" className="label">Verification code</label>
            <input
              id="code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="input text-center font-mono text-lg tracking-[0.5em]"
            />
          </div>
          <ErrorBanner message={error} />
          <Button type="submit" loading={submitting} disabled={code.length !== 6} className="w-full">
            Verify and sign in
          </Button>
          <button
            type="button"
            onClick={() => {
              setMfaToken(null);
              setCode("");
              setError(null);
            }}
            className="flex w-full items-center justify-center gap-1 text-sm text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" /> Use a different account
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your organization's workspace.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="org" className="label">Organization ID</label>
          <input
            id="org"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={organizationSlug}
            onChange={(e) => setOrganizationSlug(e.target.value)}
            placeholder="acme"
            className="input"
          />
          <p className="mt-1 text-xs text-slate-500">The short name your company uses, e.g. &ldquo;acme&rdquo;. Ask HR if unsure.</p>
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
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
            {config?.emailEnabled && (
              <Link href="/forgot-password" className="text-xs font-medium text-blue-600 hover:underline">
                Forgot password?
              </Link>
            )}
          </div>
          <PasswordInput id="password" required autoComplete="current-password" value={password} onChange={setPassword} />
          {config && !config.emailEnabled && (
            <p className="mt-1 text-xs text-slate-500">Forgot your password? Ask your HR admin to reset it from your profile.</p>
          )}
        </div>

        <ErrorBanner message={error} />

        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>

        <p className="text-center text-sm text-slate-500">
          Setting up for a new company?{" "}
          <Link href="/register" className="font-medium text-blue-600 hover:underline">
            Create an organization
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
