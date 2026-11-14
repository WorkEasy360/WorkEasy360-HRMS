import Link from "next/link";
import { ClipboardCheck, LogIn, UserPlus, Users } from "lucide-react";
import { BrandMark, PRODUCT_NAME } from "@/ui";

/**
 * The first screen of the app on a phone, as in the app design: the brand on
 * deep green, what the product does, and the way in. Tapping "Login to HRMS"
 * shows the sign-in form.
 */
export function PhoneWelcome({ onLogin, canRegister }: { onLogin: () => void; canRegister: boolean }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-surface">
      <section data-region="primary" className="c-sidebar relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 pb-12 pt-10 text-center">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-chart-single opacity-30 blur-3xl" />
        <div className="relative flex flex-col items-center">
          <span className="flex size-20 items-center justify-center rounded-3xl bg-surface shadow-lg">
            <BrandMark className="size-14" />
          </span>
          <p className="mt-4 text-3xl font-bold tracking-tight text-on-brand">
            WorkEasy<span className="text-[color:var(--we-focus-on-primary)]">360</span>
          </p>
          <span className="mt-2 rounded-lg bg-nav-active px-4 py-1 text-lg font-bold text-on-nav-active">{PRODUCT_NAME}</span>
          <h1 className="mt-6 text-2xl font-bold leading-snug text-on-brand">Simple HR Management for Small Businesses</h1>
          <p className="mt-3 max-w-xs text-base text-on-brand-muted">
            Manage employees, attendance, leave, payroll and HR requests – all in one app.
          </p>
        </div>
        {/* Decoration: a team and a checklist, as in the design. */}
        <div aria-hidden className="relative mt-10 flex items-end gap-2">
          <Users className="size-24 text-[color:var(--we-focus-on-primary)]" strokeWidth={1.5} />
          <span className="flex size-20 items-center justify-center rounded-2xl bg-surface/90 shadow-lg">
            <ClipboardCheck className="size-12 text-accent-strong" strokeWidth={1.5} />
          </span>
        </div>
      </section>
      <section className="space-y-3 rounded-t-3xl bg-surface px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 -mt-6 relative">
        <button
          type="button"
          onClick={onLogin}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--we-accent)] text-base font-semibold text-[color:var(--we-on-accent)] shadow-md"
        >
          <LogIn className="size-5" strokeWidth={2} aria-hidden />
          Login to HRMS
        </button>
        {canRegister && (
          <Link
            href="/register"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[color:var(--we-accent)] text-base font-semibold text-accent-strong"
          >
            <UserPlus className="size-5" strokeWidth={2} aria-hidden />
            Create Account
          </Link>
        )}
      </section>
    </main>
  );
}
