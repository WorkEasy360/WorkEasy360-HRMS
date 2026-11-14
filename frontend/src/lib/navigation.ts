import {
  Briefcase,
  CalendarDays,
  Clock,
  CreditCard,
  Home,
  LifeBuoy,
  Receipt,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Navigation for the essential release.
 *
 * HR/Admin get seven menus; employees get five scoped views of the same
 * records. There is no separate Approvals, Reports or Manager system: approval
 * actions appear inside Home and Attendance & Leave, and summaries live on the
 * page they belong to.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Extra search terms for the command palette. */
  keywords?: string;
};

/** Holding any of these means the person works across the organization. */
const ADMIN_PERMISSIONS = [
  "employee:read",
  "payroll:manage",
  "compensation:manage",
  "recruitment:manage",
  "org:manage",
  "role:manage",
];

export function isAdminView(hasPermission: (p: string) => boolean): boolean {
  return ADMIN_PERMISSIONS.some(hasPermission);
}

/** The seven HR/Admin menus, in order. */
export const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home, description: "Your day at a glance", keywords: "dashboard today" },
  {
    href: "/employees",
    label: "Employees",
    icon: Users,
    description: "Directory, profiles, joining and exit",
    keywords: "people staff team directory documents onboarding",
  },
  {
    href: "/attendance",
    label: "Attendance & Leave",
    icon: Clock,
    description: "Register, leave, corrections and the work schedule",
    keywords: "check in out punch holiday time off approvals corrections",
  },
  {
    href: "/payroll",
    label: "Payroll",
    icon: CreditCard,
    description: "Salary details, monthly payroll and payslips",
    keywords: "salary ctc compensation payslip finalize publish",
  },
  {
    href: "/hiring",
    label: "Hiring",
    icon: Briefcase,
    description: "Job openings, candidates and interviews",
    keywords: "recruitment jobs candidates interview",
  },
  {
    href: "/helpdesk",
    label: "Helpdesk",
    icon: LifeBuoy,
    description: "Raise or answer a ticket",
    keywords: "support ticket issue queue",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Company rules, roles, audit, automation and integrations",
    keywords: "organization holidays leave types permissions 2fa connect webhook",
  },
];

/** The five employee menus. Managers get the same, plus approval actions. */
export const EMPLOYEE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home, description: "Your day at a glance", keywords: "dashboard today" },
  {
    href: "/my-details",
    label: "My Details",
    icon: User,
    description: "Your details, documents and joining checklist",
    keywords: "profile personal emergency contact tasks",
  },
  {
    href: "/attendance",
    label: "Attendance & Leave",
    icon: Clock,
    description: "Check in, request leave, fix a past day",
    keywords: "punch clock holiday time off correction",
  },
  { href: "/payslips", label: "Payslips", icon: Receipt, description: "Your published payslips", keywords: "salary pay slip" },
  { href: "/helpdesk", label: "Helpdesk", icon: LifeBuoy, description: "Your tickets and replies", keywords: "support ticket" },
];

/** Own-record pages, always reachable from the account menu. */
export const ACCOUNT_NAV: NavItem[] = [
  { href: "/my-details", label: "My details", icon: User, description: "Your own record" },
  { href: "/payslips", label: "My payslips", icon: Receipt, description: "Your published payslips" },
];

/**
 * Mobile bottom bar. Attendance and leave are tabs of one page, so they are one
 * screen reached two ways rather than two separate workflows.
 */
export const MOBILE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home, description: "Your day at a glance" },
  { href: "/attendance", label: "Attendance", icon: Clock, description: "Check in and out" },
  { href: "/attendance?tab=leave", label: "Leave", icon: CalendarDays, description: "Request time off" },
  { href: "/helpdesk", label: "Help", icon: LifeBuoy, description: "Raise a ticket" },
];

export function mainNav(hasPermission: (p: string) => boolean): NavItem[] {
  return isAdminView(hasPermission) ? ADMIN_NAV : EMPLOYEE_NAV;
}

/** Everything the command palette can jump to for this person. */
export function searchableNav(hasPermission: (p: string) => boolean): NavItem[] {
  const main = mainNav(hasPermission);
  const extras = ACCOUNT_NAV.filter((a) => !main.some((m) => m.href === a.href));
  return [...main, ...extras];
}

/** The menu a path belongs to, for the title and the active highlight. */
export function findNavItem(pathname: string): NavItem | undefined {
  return [...ADMIN_NAV, ...EMPLOYEE_NAV, ...ACCOUNT_NAV]
    .filter((i) => !i.href.includes("?"))
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}
