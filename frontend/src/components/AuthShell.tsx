import { CalendarDays, Headset, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Lockup, PRODUCT_NAME } from "@/ui";
import { AuthHeroLaptop } from "./AuthHeroLaptop";

/**
 * What the product does, in the essential release's own terms. Nothing here
 * promises a module the release doesn't have (no performance reviews, no
 * reimbursements, no reports menu).
 */
const FEATURES = [
  { icon: Users, title: "Employee Management", text: "Employee records, documents and joining checklists" },
  { icon: CalendarDays, title: "Attendance & Leave", text: "Check in and out, leave requests and corrections" },
  { icon: Wallet, title: "Payroll & Payslips", text: "Prepare, finalize and publish monthly payroll" },
  { icon: Headset, title: "Helpdesk & Hiring", text: "HR questions, job openings and candidates" },
];

/** Soft waves along the bottom of the hero. Decoration only. */
function HeroWaves() {
  return (
    <svg aria-hidden viewBox="0 0 800 260" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%] w-full">
      <path d="M0 150 C 160 80, 300 220, 470 160 S 720 70, 800 110 L 800 260 L 0 260 Z" style={{ fill: "var(--we-nav-active)", opacity: 0.55 }} />
      <path d="M0 200 C 180 140, 330 250, 520 205 S 740 150, 800 175 L 800 260 L 0 260 Z" style={{ fill: "var(--we-chart-single)", opacity: 0.5 }} />
      <path d="M0 235 C 200 205, 380 262, 560 240 S 760 215, 800 228 L 800 260 L 0 260 Z" style={{ fill: "var(--we-sidebar-bottom)", opacity: 0.7 }} />
    </svg>
  );
}

/**
 * Split-screen layout shared by the sign-in, sign-up and password pages: the
 * green WorkEasy360 hero on the left, the form in a white card on the right.
 * These pages wear WorkEasy360's own brand, not the employer's.
 *
 * Built to fit one browser window: below 50rem / 42rem of window height
 * (`short:` / `tiny:`) spacing tightens and secondary lines drop away.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  /** Below the form inside the card, e.g. the feature tiles on sign-in. */
  footer?: ReactNode;
}) {
  return (
    <main className="grid flex-1 bg-canvas shell:grid-cols-[1.35fr_1fr]">
      <section className="c-sidebar relative hidden overflow-hidden shell:block">
        {/* Soft decorative light and waves, not content. */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-[36rem] rounded-full bg-chart-single opacity-40 blur-3xl" />
        <HeroWaves />

        <div data-region="primary" className="relative flex h-full flex-col justify-center px-12 py-8 tiny:py-6">
          <Lockup onDark layout="plain" size="lg" />

          <span className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-nav-active px-4 py-2 text-xl font-bold text-on-nav-active shadow-md short:mt-5 tiny:mt-4 tiny:py-1.5 tiny:text-lg">
            <Users className="size-6" strokeWidth={2} aria-hidden />
            {PRODUCT_NAME}
          </span>

          <h2 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-on-brand tiny:mt-3 xl:text-5xl xl:tiny:text-4xl">
            WorkEasy<span className="text-[color:var(--we-focus-on-primary)]">HRMS</span>
          </h2>
          <p className="mt-2 text-xl font-semibold text-on-brand xl:text-2xl xl:tiny:text-xl">Simple HR Management for Growing Businesses</p>
          <p className="mt-2 max-w-lg text-base text-on-brand-muted tiny:hidden">
            Manage employees, attendance, leave, payroll and HR operations from one easy platform.
          </p>

          <ul className="mt-7 space-y-4 short:mt-5 short:space-y-3">
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex items-center gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-nav-active text-on-nav-active shadow-md short:size-11">
                  <Icon className="size-6 short:size-5" strokeWidth={2} aria-hidden />
                </span>
                <span className="xl:max-w-[15rem] 2xl:max-w-xs">
                  <span className="block text-lg font-semibold leading-snug text-on-brand short:text-base">{t}</span>
                  <span className="block text-sm leading-snug text-on-brand-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* The dashboard on a laptop, beside the feature list on wide screens. */}
        <AuthHeroLaptop className="absolute bottom-[8%] right-[5%] hidden w-[46%] max-w-[36rem] xl:block" />
      </section>

      <section className="flex items-center justify-center p-4 sm:p-6 short:sm:p-4">
        <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-lg sm:px-10 sm:py-8 short:sm:py-5 tiny:sm:py-4">
          <div className="flex justify-center">
            <Lockup layout="inline" />
          </div>
          <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-heading sm:text-3xl short:mt-3 short:sm:text-2xl">{title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm text-secondary sm:text-base short:mt-1 short:sm:text-sm tiny:hidden">{subtitle}</p>
          <div className="mt-6 short:mt-4">{children}</div>
          {/* Decoration only: dropped on the shortest windows so the form always fits. */}
          {footer && <div className="mt-6 short:mt-4 [@media(max-height:38rem)]:hidden">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

/** The three tiles under the sign-in card. Decoration that names the product's jobs. */
export function AuthFeatureTiles() {
  const tiles = [
    { icon: Users, label: "Manage Employees" },
    { icon: CalendarDays, label: "Track Attendance" },
    { icon: Wallet, label: "Run Payroll" },
  ];
  return (
    <ul className="grid grid-cols-3 gap-3" aria-label="What you can do">
      {tiles.map(({ icon: Icon, label }) => (
        <li key={label} className="flex flex-col items-center gap-1.5 rounded-xl bg-accent-soft px-2 py-3 text-center text-sm font-semibold leading-tight text-heading short:py-2 short:text-xs">
          <Icon className="size-7 text-accent-strong short:size-6" strokeWidth={1.75} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Only allow redirects to paths inside this app (no protocol-relative or absolute URLs). */
export function safeNextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}
