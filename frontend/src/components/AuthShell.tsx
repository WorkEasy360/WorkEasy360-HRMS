import { CalendarDays, CheckCircle2, Clock, Receipt } from "lucide-react";
import type { ReactNode } from "react";

const HIGHLIGHTS = [
  { icon: Clock, text: "Check in and out in one click" },
  { icon: CalendarDays, text: "Request leave and see approvals instantly" },
  { icon: Receipt, text: "Payslips, expenses and loans in one place" },
  { icon: CheckCircle2, text: "Managers approve everything from one inbox" },
];

/** Split-screen layout shared by the sign-in and sign-up pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#0b1220] p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold">W</div>
          <span className="text-lg font-semibold">WorkEasy360</span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight">Everything your team needs from HR, in one place.</h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-slate-300">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-blue-300">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">WorkEasy360 HRMS</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">W</div>
            <span className="text-lg font-semibold">WorkEasy360</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
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
