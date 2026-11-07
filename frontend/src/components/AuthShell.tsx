import { CalendarDays, CheckCircle2, Clock, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { Lockup } from "@/ui";

const HIGHLIGHTS = [
  { icon: Clock, text: "Check in and out in one click" },
  { icon: CalendarDays, text: "Request leave and see approvals instantly" },
  { icon: Receipt, text: "Payslips, expenses and loans in one place" },
  { icon: CheckCircle2, text: "Managers approve everything from one inbox" },
];

/**
 * Split-screen layout shared by the sign-in and sign-up pages. These pages are
 * outside the signed-in shell and wear WorkEasy360's own brand, not the
 * employer's.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="grid flex-1 shell:grid-cols-2">
      <section data-region="primary" className="hidden flex-col justify-between bg-navy p-10 shell:flex">
        <Lockup onDark />
        <div>
          <h2 className="max-w-md text-2xl font-semibold leading-tight text-on-navy">
            Everything your team needs from HR, in one place.
          </h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-on-navy">
                <span className="flex size-8 items-center justify-center rounded-md bg-muted text-accent">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-on-navy-muted">WorkEasy360 HRMS</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 shell:hidden">
            <Lockup />
          </div>
          <h1 className="c-title">{title}</h1>
          <p className="c-subtitle">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </section>
    </main>
  );
}

/** Only allow redirects to paths inside this app (no protocol-relative or absolute URLs). */
export function safeNextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}
