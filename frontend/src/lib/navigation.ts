import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Clock,
  CreditCard,
  Home,
  Landmark,
  Laptop,
  LifeBuoy,
  ListChecks,
  Megaphone,
  Package,
  Receipt,
  ShieldCheck,
  Target,
  Timer,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Extra search terms for the command palette. */
  keywords?: string;
  /** Shown only if the user has at least one of these permissions. Omit for everyone. */
  anyOf?: string[];
};
export type NavGroup = { title?: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "Home", icon: Home, description: "Your day at a glance", keywords: "dashboard" }] },
  {
    title: "My Workspace",
    items: [
      { href: "/my-profile", label: "My Profile", icon: User, description: "Your personal and job details", keywords: "me account" },
      { href: "/my-attendance", label: "My Attendance", icon: Clock, description: "Check in, check out, history", keywords: "punch clock in out" },
      { href: "/my-leave", label: "My Leave", icon: CalendarDays, description: "Request time off and track it", keywords: "vacation holiday time off pto sick" },
      { href: "/my-timesheet", label: "My Timesheet", icon: Timer, description: "Log hours worked", keywords: "hours log" },
      { href: "/my-tasks", label: "My Tasks", icon: ListChecks, description: "Your onboarding checklist", keywords: "todo checklist" },
      { href: "/goals", label: "My Goals", icon: Target, description: "Track goals and progress", keywords: "okr objectives" },
      { href: "/my-payslips", label: "My Payslips", icon: Receipt, description: "Salary slips", keywords: "salary pay slip" },
      { href: "/my-expenses", label: "My Expenses", icon: Wallet, description: "Submit and track claims", keywords: "reimbursement claim bill" },
      { href: "/my-loans", label: "My Loans", icon: Landmark, description: "Request a loan, track EMIs", keywords: "advance emi" },
      { href: "/my-assets", label: "My Assets", icon: Laptop, description: "Equipment assigned to you", keywords: "laptop device" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/people", label: "Directory", icon: Users, description: "Everyone in your organization", keywords: "employees staff team", anyOf: ["employee:read"] },
      { href: "/approvals", label: "Approvals", icon: CheckSquare, description: "Requests waiting on you", keywords: "approve reject pending" },
      { href: "/shifts", label: "Shifts", icon: CalendarClock, description: "Shift schedules", keywords: "roster schedule" },
    ],
  },
  {
    title: "Talent",
    items: [
      { href: "/onboarding", label: "Onboarding", icon: UserPlus, description: "New-joiner checklists", anyOf: ["onboarding:manage"] },
      { href: "/performance", label: "Performance", icon: TrendingUp, description: "Reviews and ratings", keywords: "appraisal review rating" },
      { href: "/recruitment", label: "Recruitment", icon: Briefcase, description: "Jobs and candidates", keywords: "hiring jobs candidates", anyOf: ["recruitment:manage"] },
    ],
  },
  {
    title: "HR Services",
    items: [
      { href: "/helpdesk", label: "Help Desk", icon: LifeBuoy, description: "Raise or track a ticket", keywords: "support ticket issue" },
      { href: "/announcements", label: "Announcements", icon: Megaphone, description: "Company news", keywords: "news" },
      { href: "/hr-guide", label: "HR Guide", icon: BookOpen, description: "Policies and how-tos", keywords: "policy handbook" },
      { href: "/assets", label: "Assets", icon: Package, description: "Company asset inventory", keywords: "inventory equipment", anyOf: ["asset:manage"] },
    ],
  },
  {
    title: "Payroll & Insights",
    items: [
      {
        href: "/payroll",
        label: "Payroll",
        icon: CreditCard,
        description: "Runs, compensation, reimbursements",
        keywords: "salary ctc compensation",
        anyOf: ["payroll:manage", "compensation:manage", "expense:manage", "loan:manage"],
      },
      { href: "/reports", label: "Reports", icon: BarChart3, description: "Headcount, attrition, costs", keywords: "analytics", anyOf: ["employee:read"] },
      { href: "/automation", label: "Automation", icon: Zap, description: "When-this-then-that rules", keywords: "rules workflow", anyOf: ["automation:manage"] },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/settings/organization", label: "Organization", icon: Building2, description: "Organization profile", keywords: "company settings" },
      { href: "/settings/security", label: "Security", icon: ShieldCheck, description: "Two-factor auth and audit log", keywords: "2fa password mfa audit" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function canSee(item: NavItem, hasPermission: (p: string) => boolean) {
  return !item.anyOf || item.anyOf.some(hasPermission);
}

/** Groups filtered to what the current user can actually use; empty groups are dropped. */
export function visibleGroups(hasPermission: (p: string) => boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, hasPermission)) })).filter((g) => g.items.length > 0);
}

export function findNavItem(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}
