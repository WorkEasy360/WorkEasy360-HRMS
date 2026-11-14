"use client";

import { FormEvent, useState } from "react";
import { Check, Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { errorMessage, useFeedback } from "@/components/feedback";
import { PasswordInput, PasswordStrength } from "@/components/PasswordInput";
import { Button, Card, ErrorBanner } from "@/ui";
import { apiFetch, setTokens } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * Settings 7.3.1 — My account & security. Password, two-factor setup and
 * recovery all use the shared WorkEasy360 account: HRMS has no authentication
 * system of its own.
 */
export function AccountSection() {
  const { user, refetchUser } = useAuth();
  return (
    <div className="max-w-3xl space-y-6">
      <PasswordSection onChanged={refetchUser} mustChange={user?.mustChangePassword ?? false} />
      <TwoFactorSection totpEnabled={user?.totpEnabled ?? false} onChanged={refetchUser} />
      <Card className="p-5">
        <h2 className="font-semibold text-heading">Lost your phone?</h2>
        <p className="mt-1 text-sm text-secondary">
          Two-factor recovery runs through your shared WorkEasy360 account. Ask an administrator in your organization to reset
          your access, or contact WorkEasy360 support from the Helpdesk.
        </p>
      </Card>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, description }: { icon: typeof KeyRound; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-link">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="font-semibold text-heading">{title}</h2>
        <p className="text-sm text-secondary">{description}</p>
      </div>
    </div>
  );
}

function PasswordSection({ onChanged, mustChange }: { onChanged: () => Promise<void>; mustChange: boolean }) {
  const { toast } = useFeedback();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirmNext) {
      setError("The new passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const tokens = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setTokens(tokens.accessToken, tokens.refreshToken);
      await onChanged();
      setCurrent("");
      setNext("");
      setConfirmNext("");
      toast.success("Password updated. You've been signed out of other devices.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <SectionTitle icon={KeyRound} title="Password" description="Changing it signs you out everywhere else." />
      {mustChange && (
        <p className="c-alert mt-4" data-tone="warning">
          You&apos;re using the temporary password HR gave you. Enter it as your current password and choose a new one.
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-4 grid max-w-md gap-3">
        <div>
          <label htmlFor="current-password" className="c-label">Current password</label>
          <PasswordInput id="current-password" autoComplete="current-password" required value={current} onChange={setCurrent} />
        </div>
        <div>
          <label htmlFor="new-password" className="c-label">New password</label>
          <PasswordInput id="new-password" autoComplete="new-password" required value={next} onChange={setNext} />
          <PasswordStrength password={next} />
        </div>
        <div>
          <label htmlFor="confirm-password" className="c-label">Confirm new password</label>
          <PasswordInput id="confirm-password" autoComplete="new-password" required value={confirmNext} onChange={setConfirmNext} />
        </div>
        <ErrorBanner message={error} />
        <div>
          <Button type="submit" loading={submitting}>Update password</Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorSection({ totpEnabled, onChanged }: { totpEnabled: boolean; onChanged: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setSubmitting(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const startSetup = () =>
    run(async () => {
      setSetup(await apiFetch<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", { method: "POST" }));
    });

  const confirmSetup = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await apiFetch("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ token: code }) });
      setSetup(null);
      setCode("");
      await onChanged();
      toast.success("Two-factor authentication is on.");
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await apiFetch("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, token: code }) });
      setPassword("");
      setCode("");
      await onChanged();
      toast.info("Two-factor authentication is off.");
    });
  };

  async function copySecret() {
    if (!setup) return;
    await navigator.clipboard.writeText(setup.secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const codeInput = (
    <div>
      <label htmlFor="totp-code" className="c-label">6-digit code from your app</label>
      <input
        id="totp-code"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="123456"
        className="c-input max-w-40 font-mono tracking-[0.3em]"
      />
    </div>
  );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          icon={totpEnabled ? ShieldCheck : ShieldOff}
          title="Two-factor authentication"
          description="Ask for a code from your phone in addition to your password when signing in."
        />
        <span
          className="c-badge"
          data-tone={totpEnabled ? "success" : "warning"}
        >
          {totpEnabled ? "On" : "Off"}
        </span>
      </div>

      <div className="mt-4 max-w-md">
        {totpEnabled ? (
          <form onSubmit={disable} className="space-y-3">
            <p className="text-sm text-body">To turn it off, confirm your password and a current code.</p>
            <div>
              <label htmlFor="disable-password" className="c-label">Password</label>
              <PasswordInput id="disable-password" autoComplete="current-password" required value={password} onChange={setPassword} />
            </div>
            {codeInput}
            <ErrorBanner message={error} />
            <Button type="submit" variant="secondary" loading={submitting}>Turn off 2FA</Button>
          </form>
        ) : setup ? (
          <form onSubmit={confirmSetup} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-body">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
              <li>Add an account and choose &ldquo;Enter a setup key&rdquo;.</li>
              <li>Paste the key below, then enter the code the app shows.</li>
            </ol>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-wider">
                {setup.secret.match(/.{1,4}/g)?.join(" ")}
              </code>
              <Button type="button" variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copySecret}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <a href={setup.otpauthUrl} className="inline-block text-xs c-link">
              On this phone? Open in your authenticator app
            </a>
            {codeInput}
            <ErrorBanner message={error} />
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>Turn on 2FA</Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <ErrorBanner message={error} />
            <Button onClick={startSetup} loading={submitting} icon={ShieldCheck}>Set up 2FA</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
