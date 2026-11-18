"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Building2, KeyRound, LogIn, Lock, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { AuthFeatureTiles, AuthShell, safeNextPath } from "@/components/AuthShell";
import { errorMessage } from "@/components/feedback";
import { ApiError, workeasy360SignInUrl } from "@/lib/api";
import { isNativeApp } from "@/lib/native";
import { PasswordInput } from "@/components/PasswordInput";
import { PhoneWelcome } from "@/components/phone/PhoneWelcome";
import { useIsPhone } from "@/lib/use-phone";
import { Button, ErrorBanner } from "@/ui";
import { useAuth } from "@/lib/auth-context";
import { useAppConfig } from "@/lib/use-app-config";

// Saved only after a sign-in that needed the organization ID. (The older
// "lastOrganizationSlug" key saved it for everyone and is cleared on load.)
const LAST_ORG_KEY = "signInOrganizationSlug";
const LEGACY_ORG_KEY = "lastOrganizationSlug";
const LAST_EMAIL_KEY = "lastSignInEmail";

/** What a failed WorkEasy360 sign-in (`/login?sso_error=<code>`) means for the person. */
const SSO_ERRORS: Record<string, string> = {
  unavailable: "WorkEasy360 sign-in isn't available right now. Please try again shortly.",
  expired: "That sign-in took too long or was started in another browser. Please try again.",
  cancelled: "Sign-in was cancelled.",
  refused: "WorkEasy360 couldn't confirm your sign-in. Please try again.",
  wrong_product: "That sign-in was meant for a different product. Please try again from WorkEasy360.",
  wrong_organization: "That sign-in was for a different organization than the one you chose. Please try again.",
  organization_missing: "Choose an organization in WorkEasy360, then try again.",
  email_unverified: "Verify your email address in WorkEasy360, then try again.",
  not_entitled: "Your organization doesn't have access to HRMS. Ask an administrator in WorkEasy360.",
  access_unverified: "HRMS couldn't confirm your organization's access with WorkEasy360. Please try again shortly.",
  organization_not_linked: "Your organization isn't set up in HRMS yet. Ask your administrator.",
  not_enrolled: "You're not set up in your company's HRMS yet. Ask your HR team to add you with this email address.",
  account_disabled: "This account has been deactivated. Contact your HR team.",
  account_conflict:
    "An HRMS account with this email already exists but isn't linked to this WorkEasy360 account. Contact your administrator to link it.",
  rate_limited: "Too many sign-in attempts. Please wait a minute and try again.",
};

export default function LoginPage() {
  const { user, loading, login, completeMfaLogin } = useAuth();
  const config = useAppConfig();
  const router = useRouter();
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // "Remember me" decides whether this device keeps the organization ID and
  // email for next time. Sign-in itself always works the same way.
  const [remember, setRemember] = useState(true);
  // The organization ID is asked for only when it is needed: the email is
  // used in several organizations, or this device signed in with one before.
  const [needOrganization, setNeedOrganization] = useState(false);
  const [showResetHint, setShowResetHint] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  // Phones open on the welcome screen; "Login to HRMS" shows the form. A
  // redirect back to a page (?next=) or a prefilled email goes straight to it.
  const isPhone = useIsPhone();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The Android app keeps password sign-in for now: WorkEasy360 sign-in from an app needs the
  // system browser and an app-link redirect (RFC 8252, docs/workeasy360-sso.md), not this WebView.
  const [native, setNative] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the native bridge is only visible after hydration
    setNative(isNativeApp());
  }, []);
  const workeasy360Available = Boolean(config?.workeasy360?.enabled) && !native;
  const passwordAllowed = config?.passwordSignIn !== false;

  // Already signed in: skip the form.
  useEffect(() => {
    if (!loading && user) router.replace(safeNextPath());
  }, [loading, user, router]);

  // Pre-fill the organization ID used last time on this device, and the email after a password reset.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const prefillEmail = search.get("email");
    const ssoError = search.get("sso_error");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring saved values on mount
    if (prefillEmail || search.get("next") || ssoError) setShowForm(true);
    if (ssoError) setError(SSO_ERRORS[ssoError] ?? SSO_ERRORS.refused);
    if (prefillEmail) setEmail(prefillEmail);
    try {
      localStorage.removeItem(LEGACY_ORG_KEY);
      const last = localStorage.getItem(LAST_ORG_KEY);
      if (last) {
        setOrganizationSlug(last);
        setNeedOrganization(true);
      }
      const lastEmail = localStorage.getItem(LAST_EMAIL_KEY);
      if (lastEmail && !prefillEmail) setEmail(lastEmail);
      if (!last && !lastEmail) setRemember(localStorage.getItem("rememberSignIn") !== "false");
    } catch {
      // Storage unavailable; the user just types it.
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const slug = needOrganization ? organizationSlug.trim().toLowerCase() : "";
      const result = await login(slug, email.trim(), password);
      try {
        if (remember) {
          if (slug) localStorage.setItem(LAST_ORG_KEY, slug);
          else localStorage.removeItem(LAST_ORG_KEY);
          localStorage.setItem(LAST_EMAIL_KEY, email.trim());
          localStorage.removeItem("rememberSignIn");
        } else {
          localStorage.removeItem(LAST_ORG_KEY);
          localStorage.removeItem(LAST_EMAIL_KEY);
          localStorage.setItem("rememberSignIn", "false");
        }
      } catch {}
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
        setPassword("");
      } else {
        router.replace(safeNextPath());
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setNeedOrganization(true);
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
          <div className="flex items-center gap-3 rounded-md bg-accent-soft p-3 text-sm text-accent-strong">
            <ShieldCheck className="h-5 w-5 shrink-0 text-link" />
            Your account is protected with two-factor authentication.
          </div>
          <div>
            <label htmlFor="code" className="c-label">Verification code</label>
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
              className="c-input text-center font-mono text-lg tracking-[0.5em]"
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
            className="flex w-full items-center justify-center gap-1 text-sm text-secondary hover:text-heading"
          >
            <ArrowLeft className="h-4 w-4" /> Use a different account
          </button>
        </form>
      </AuthShell>
    );
  }

  const workeasy360Button = workeasy360Available && (
    <a
      href={workeasy360SignInUrl(safeNextPath())}
      className="flex h-11 w-full short:h-10 items-center justify-center gap-2 rounded-md border-2 border-[color:var(--we-accent)] text-base font-semibold text-accent-strong hover:bg-accent-soft"
    >
      <KeyRound className="size-5" strokeWidth={2} aria-hidden />
      Continue with WorkEasy360
    </a>
  );

  if (config && !passwordAllowed) {
    // WorkEasy360 is the only way in (WORKEASY360_SSO_ONLY). Never started automatically from
    // this page: the person chooses, so a sign-out never ends in a silent sign-in.
    return (
      <AuthShell title="HRMS Login" subtitle="Sign in with your WorkEasy360 account." footer={<AuthFeatureTiles />}>
        <div className="space-y-4">
          <ErrorBanner message={error} />
          {workeasy360Button || (
            <p className="c-hint" role="status">
              {native
                ? "Sign in with WorkEasy360 isn't available in the app yet. Please use HRMS in your browser."
                : "Sign-in is being set up. Please try again shortly."}
            </p>
          )}
        </div>
      </AuthShell>
    );
  }

  if (isPhone && !showForm) {
    return <PhoneWelcome onLogin={() => setShowForm(true)} canRegister={!!config?.registrationEnabled} />;
  }

  return (
    <AuthShell
      title="HRMS Login"
      subtitle="Sign in to access your HRMS workspace and manage your employees, attendance and payroll."
      footer={<AuthFeatureTiles />}
    >
      <form onSubmit={onSubmit} className="space-y-4 short:space-y-3">
        <div>
          <label htmlFor="email" className="c-label font-semibold text-heading">
            Email Address
          </label>
          <div className="c-input-group">
            <Mail strokeWidth={2} aria-hidden />
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="c-input h-11 w-full short:h-10"
            />
          </div>
        </div>
        <div>
          <label htmlFor="password" className="c-label font-semibold text-heading">
            Password
          </label>
          <PasswordInput
            id="password"
            icon={Lock}
            required
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
          />
        </div>

        {needOrganization && (
          <div>
            <label htmlFor="org" className="c-label font-semibold text-heading">
              Organization ID
            </label>
            <div className="c-input-group">
              <Building2 strokeWidth={2} aria-hidden />
              <input
                id="org"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={organizationSlug}
                onChange={(e) => setOrganizationSlug(e.target.value)}
                placeholder="Your company's short ID, e.g. acme"
                className="c-input h-11 w-full short:h-10"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" className="c-checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me
          </label>
          {config?.emailEnabled ? (
            <Link href="/forgot-password" className="font-semibold text-link hover:underline">
              Forgot Password?
            </Link>
          ) : (
            <button type="button" onClick={() => setShowResetHint((v) => !v)} className="font-semibold text-link hover:underline" aria-expanded={showResetHint}>
              Forgot Password?
            </button>
          )}
        </div>
        {showResetHint && !config?.emailEnabled && (
          <p className="c-hint -mt-1" role="status">
            Ask your HR team to reset your password. They can send you a new one from your employee record.
          </p>
        )}

        <ErrorBanner message={error} />

        <Button type="submit" icon={LogIn} loading={submitting} className="h-11 w-full text-base short:h-10">
          Log In to HRMS
        </Button>

        {workeasy360Button && (
          <>
            <div className="flex items-center gap-3 text-sm text-secondary" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              <span className="rounded-full border border-line px-3 py-1 short:py-0">OR</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            {workeasy360Button}
          </>
        )}

        {config?.registrationEnabled && (
          <>
            <div className="flex items-center gap-3 text-sm text-secondary" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              <span className="rounded-full border border-line px-3 py-1 short:py-0">OR</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <Link
              href="/register"
              className="flex h-11 w-full short:h-10 items-center justify-center gap-2 rounded-md border-2 border-[color:var(--we-accent)] text-base font-semibold text-accent-strong hover:bg-accent-soft"
            >
              <UserPlus className="size-5" strokeWidth={2} aria-hidden />
              Create HRMS Account
            </Link>
          </>
        )}
      </form>
    </AuthShell>
  );
}
