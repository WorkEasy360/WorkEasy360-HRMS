"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { errorMessage, useFeedback } from "@/components/feedback";
import { PasswordInput, PasswordStrength, passwordIssues } from "@/components/PasswordInput";
import { Button, ErrorBanner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useAppConfig } from "@/lib/use-app-config";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function RegisterPage() {
  const { register } = useAuth();
  const config = useAppConfig();
  const { toast } = useFeedback();
  const router = useRouter();
  const [form, setForm] = useState({
    organizationName: "",
    organizationSlug: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  // Keep suggesting a slug from the name until the user edits the slug themselves.
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (passwordIssues(form.password).length) {
      setError(`Password still needs ${passwordIssues(form.password).join(", ")}.`);
      return;
    }
    setSubmitting(true);
    try {
      const org = await register(form);
      try {
        localStorage.setItem("lastOrganizationSlug", org.slug);
      } catch {}
      toast.success(`Welcome to WorkEasy360! Your team signs in with the organization ID "${org.slug}".`);
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (config && !config.registrationEnabled) {
    return (
      <AuthShell title="Sign-up is closed" subtitle="New organizations can't be created here.">
        <p className="text-sm text-slate-600">
          If your company already uses WorkEasy360, ask your HR administrator to add you, then{" "}
          <Link href="/login" className="font-medium text-blue-600 hover:underline">
            sign in
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your organization" subtitle="You'll be the first admin. It takes under a minute.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="org-name" className="label">Company name</label>
          <input
            id="org-name"
            required
            maxLength={120}
            value={form.organizationName}
            onChange={(e) => {
              set("organizationName", e.target.value);
              if (!slugTouched) set("organizationSlug", slugify(e.target.value));
            }}
            placeholder="Acme Inc"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="org-slug" className="label">Organization ID</label>
          <input
            id="org-slug"
            required
            maxLength={48}
            pattern="[a-z0-9-]{2,48}"
            title="Lowercase letters, numbers and hyphens"
            autoCapitalize="none"
            spellCheck={false}
            value={form.organizationSlug}
            onChange={(e) => {
              setSlugTouched(true);
              set("organizationSlug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            placeholder="acme"
            className="input"
          />
          <p className="mt-1 text-xs text-slate-500">Everyone uses this to sign in. Lowercase letters, numbers and hyphens.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="first-name" className="label">First name</label>
            <input id="first-name" required maxLength={80} autoComplete="given-name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="input" />
          </div>
          <div>
            <label htmlFor="last-name" className="label">Last name</label>
            <input id="last-name" required maxLength={80} autoComplete="family-name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@company.com" className="input" />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <PasswordInput id="password" required autoComplete="new-password" value={form.password} onChange={(v) => set("password", v)} />
          <PasswordStrength password={form.password} />
        </div>

        <ErrorBanner message={error} />

        <Button type="submit" loading={submitting} className="w-full">
          Create organization
        </Button>

        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
