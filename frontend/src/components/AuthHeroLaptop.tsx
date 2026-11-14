import type { CSSProperties } from "react";

/**
 * The laptop on the sign-in hero: a drawing of the HR dashboard, not a live
 * one. Its menus are the essential release's own (no reports or performance),
 * and the figures are illustrative. Decorative, so hidden from screen readers.
 *
 * Plain SVG in a viewBox, so it scales with the hero. Every colour is a
 * design token, so it follows light and dark mode with the rest of the app.
 */
const c = (token: string): CSSProperties => ({ fill: `var(--we-${token})` });
const stroke = (token: string, width = 1): CSSProperties => ({ stroke: `var(--we-${token})`, strokeWidth: width, fill: "none" });

const NAV = ["Dashboard", "Employees", "Attendance", "Payroll", "Hiring", "Helpdesk", "Settings"];
const STATS = [
  { label: "Present Today", value: "148 / 162", note: "91% of the team" },
  { label: "Leave Requests", value: "12", note: "Waiting on you" },
  { label: "Payroll (This Month)", value: "₹18,75,000", note: "Draft" },
  { label: "Total Employees", value: "162", note: "4 joined this month" },
];
const BARS = [72, 80, 76, 88, 84, 91, 86];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const APPROVALS = [
  { label: "Leave Requests", count: 6 },
  { label: "Attendance Corrections", count: 3 },
  { label: "Helpdesk Tickets", count: 2 },
];
const ACTIONS = ["Add Employee", "Prepare Payroll", "Post Announcement"];

// Donut: present, on leave, not checked in, as fractions of the ring.
const R = 26;
const CIRC = 2 * Math.PI * R;
const SLICES = [
  { token: "chart-present", share: 0.78, label: "Present (126)" },
  { token: "chart-leave", share: 0.12, label: "On Leave (20)" },
  { token: "chart-pending", share: 0.1, label: "Not In Yet (16)" },
];
const SLICE_STARTS = SLICES.map((_, i) => SLICES.slice(0, i).reduce((sum, s) => sum + s.share, 0));

export function AuthHeroLaptop({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none select-none ${className}`}>
      <div className="[transform:perspective(1400px)_rotateY(-16deg)_rotateX(4deg)] drop-shadow-2xl">
        {/* Screen with its bezel. */}
        <div className="rounded-t-[1.1rem] p-[2.2%] pb-[2.6%]" style={{ background: "var(--we-device-frame)" }}>
          <svg viewBox="0 0 640 400" className="block w-full rounded-[0.35rem]" role="presentation">
            <rect width="640" height="400" style={c("background")} />

            {/* Sidebar */}
            <rect width="122" height="400" style={c("sidebar-top")} />
            <circle cx="20" cy="22" r="8" style={c("chart-single")} />
            <text x="33" y="26" fontSize="10.5" fontWeight="700" style={c("on-primary")}>
              WorkEasy<tspan style={c("chart-single")}>HRMS</tspan>
            </text>
            {NAV.map((item, i) => (
              <g key={item}>
                {i === 0 && <rect x="8" y={48 + i * 28} width="106" height="22" rx="6" style={c("nav-active")} />}
                <rect x="18" y={55 + i * 28} width="8" height="8" rx="2" style={c(i === 0 ? "on-nav-active" : "on-primary-muted")} />
                <text x="34" y={63 + i * 28} fontSize="10" fontWeight={i === 0 ? 600 : 500} style={c(i === 0 ? "on-nav-active" : "on-primary-muted")}>
                  {item}
                </text>
              </g>
            ))}

            {/* Top bar */}
            <rect x="122" width="518" height="34" style={c("surface")} />
            <line x1="122" y1="34" x2="640" y2="34" style={stroke("border")} />
            {[540, 562, 584].map((x) => (
              <circle key={x} cx={x} cy="17" r="6" style={stroke("text-secondary", 1.4)} />
            ))}
            <circle cx="612" cy="17" r="10" style={c("accent-soft")} />
            <text x="612" y="21" fontSize="9" fontWeight="700" textAnchor="middle" style={c("accent-strong")}>
              HR
            </text>

            {/* Stat cards */}
            {STATS.map((s, i) => {
              const x = 132 + i * 127;
              return (
                <g key={s.label}>
                  <rect x={x} y="44" width="119" height="58" rx="7" style={c("surface")} />
                  <text x={x + 9} y="60" fontSize="8" style={c("text-secondary")}>
                    {s.label}
                  </text>
                  <text x={x + 9} y="80" fontSize="14" fontWeight="700" style={c("text-primary")}>
                    {s.value}
                  </text>
                  <text x={x + 9} y="94" fontSize="7.5" style={c("text-secondary")}>
                    {s.note}
                  </text>
                </g>
              );
            })}

            {/* Attendance trend */}
            <rect x="132" y="112" width="246" height="160" rx="7" style={c("surface")} />
            <text x="142" y="130" fontSize="9.5" fontWeight="700" style={c("text-primary")}>
              Attendance Trend (Last 7 Days)
            </text>
            {[0, 1, 2, 3].map((g) => (
              <line key={g} x1="152" x2="368" y1={150 + g * 30} y2={150 + g * 30} style={stroke("chart-grid")} />
            ))}
            {BARS.map((v, i) => {
              const h = (v / 100) * 90;
              const x = 160 + i * 30;
              return (
                <g key={DAYS[i]}>
                  <rect x={x} y={240 - h} width="14" height={h} rx="3" style={c("chart-single")} />
                  <text x={x + 7} y="256" fontSize="7.5" textAnchor="middle" style={c("text-secondary")}>
                    {DAYS[i]}
                  </text>
                </g>
              );
            })}

            {/* Employees by status */}
            <rect x="386" y="112" width="244" height="160" rx="7" style={c("surface")} />
            <text x="396" y="130" fontSize="9.5" fontWeight="700" style={c("text-primary")}>
              Today&apos;s Status
            </text>
            <g transform="rotate(-90 440 196)">
              {SLICES.map((s, i) => (
                <circle
                  key={s.token}
                  cx="440"
                  cy="196"
                  r={R}
                  style={{ ...stroke(s.token, 11), strokeDasharray: `${s.share * CIRC - 2} ${CIRC}`, strokeDashoffset: -SLICE_STARTS[i] * CIRC }}
                />
              ))}
            </g>
            <text x="440" y="199" fontSize="12" fontWeight="700" textAnchor="middle" style={c("text-primary")}>
              162
            </text>
            <text x="440" y="209" fontSize="6.5" textAnchor="middle" style={c("text-secondary")}>
              Total
            </text>
            {SLICES.map((s, i) => (
              <g key={s.label}>
                <circle cx="490" cy={176 + i * 18} r="4" style={c(s.token)} />
                <text x="499" y={179 + i * 18} fontSize="8" style={c("text-body")}>
                  {s.label}
                </text>
              </g>
            ))}

            {/* Pending approvals */}
            <rect x="132" y="282" width="246" height="108" rx="7" style={c("surface")} />
            <text x="142" y="300" fontSize="9.5" fontWeight="700" style={c("text-primary")}>
              Pending Approvals
            </text>
            {APPROVALS.map((a, i) => (
              <g key={a.label}>
                <circle cx="148" cy={318 + i * 24} r="5" style={c("accent-soft")} />
                <text x="159" y={321 + i * 24} fontSize="8.5" style={c("text-body")}>
                  {a.label}
                </text>
                <rect x="340" y={311 + i * 24} width="26" height="14" rx="7" style={c("accent-soft")} />
                <text x="353" y={321 + i * 24} fontSize="8" fontWeight="700" textAnchor="middle" style={c("accent-strong")}>
                  {a.count}
                </text>
              </g>
            ))}

            {/* Quick actions */}
            <rect x="386" y="282" width="244" height="108" rx="7" style={c("surface")} />
            <text x="396" y="300" fontSize="9.5" fontWeight="700" style={c("text-primary")}>
              Quick Actions
            </text>
            {ACTIONS.map((a, i) => (
              <g key={a}>
                <rect x="396" y={311 + i * 24} width="10" height="10" rx="2" style={c("chart-single")} />
                <text x="413" y={320 + i * 24} fontSize="8.5" style={c("text-body")}>
                  {a}
                </text>
                <text x="612" y={320 + i * 24} fontSize="9" style={c("text-secondary")}>
                  ›
                </text>
              </g>
            ))}
          </svg>
        </div>
        {/* Base and hinge. */}
        <div className="relative -mx-[7%] h-[0.9rem] rounded-b-[1.2rem] rounded-t-[0.2rem]" style={{ background: "var(--we-device-base)" }}>
          <div className="absolute inset-x-0 bottom-0 h-[35%] rounded-b-[1.2rem]" style={{ background: "var(--we-device-edge)" }} />
          <div className="absolute left-1/2 top-0 h-[40%] w-[16%] -translate-x-1/2 rounded-b-md" style={{ background: "var(--we-device-edge)" }} />
        </div>
      </div>
    </div>
  );
}
