// Permission catalog for the essential release (Settings 7.2).
// Payroll and helpdesk queue access are explicit, separate grants: a manager
// approving leave must not inherit salary, document or export access.
export const PERMISSIONS = {
  ORG_MANAGE: "org:manage",
  DEPARTMENT_MANAGE: "department:manage",
  DEPARTMENT_READ: "department:read",
  EMPLOYEE_READ: "employee:read",
  EMPLOYEE_WRITE: "employee:write",
  /** Recording an exit and revoking HRMS access (Employees 2.4). */
  EMPLOYEE_EXIT_MANAGE: "employee:exit",
  /** Uploading, viewing and verifying documents on someone else's profile. */
  DOCUMENT_MANAGE: "document:manage",
  ROLE_MANAGE: "role:manage",
  /** Authorized HR: may decide any leave request in the organization. */
  LEAVE_MANAGE: "leave:manage",
  /** Assigned manager: may decide their own direct reports' leave (rule 06). */
  LEAVE_APPROVE: "leave:approve",
  /** Authorized HR: may decide any attendance correction (Attendance 3.1.3). */
  ATTENDANCE_MANAGE: "attendance:manage",
  /** Assigned manager: may decide their own direct reports' corrections. */
  ATTENDANCE_APPROVE: "attendance:approve",
  ANNOUNCEMENT_READ: "announcement:read",
  ANNOUNCEMENT_MANAGE: "announcement:manage",
  /** Publishing and editing HR policies (Settings 7.1.4). */
  POLICY_MANAGE: "policy:manage",
  ONBOARDING_MANAGE: "onboarding:manage",
  COMPENSATION_MANAGE: "compensation:manage",
  PAYROLL_MANAGE: "payroll:manage",
  /** Employer HR ticket queue. */
  HELPDESK_MANAGE: "helpdesk:manage",
  /** Restricted salary/payslip ticket queue (Helpdesk routing 01). */
  HELPDESK_PAYROLL_QUEUE: "helpdesk:payroll",
  AUTOMATION_MANAGE: "automation:manage",
  AUDIT_READ: "audit:read",
  RECRUITMENT_MANAGE: "recruitment:manage",
  /** Settings 7.6 — authorizing WorkEasy Connect connections and mappings. */
  INTEGRATION_MANAGE: "integration:manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

/** Keys dropped with the modules removed from the essential release. */
export const RETIRED_PERMISSIONS = [
  "shift:manage",
  "timesheet:manage",
  "performance:manage",
  "hrguide:manage",
  "expense:manage",
  "asset:manage",
  "loan:manage",
];

// System default roles seeded for every new organization.
export const SYSTEM_ROLES: Record<string, PermissionKey[]> = {
  Admin: ALL_PERMISSIONS,
  HR: [
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.DEPARTMENT_READ,
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_WRITE,
    PERMISSIONS.EMPLOYEE_EXIT_MANAGE,
    PERMISSIONS.DOCUMENT_MANAGE,
    PERMISSIONS.LEAVE_MANAGE,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ANNOUNCEMENT_READ,
    PERMISSIONS.ANNOUNCEMENT_MANAGE,
    PERMISSIONS.POLICY_MANAGE,
    PERMISSIONS.ONBOARDING_MANAGE,
    PERMISSIONS.HELPDESK_MANAGE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.RECRUITMENT_MANAGE,
  ],
  // Managers approve their own direct reports' requests and nothing more:
  // no unrestricted payroll, documents or exports (Attendance & Leave rule 07).
  Manager: [
    PERMISSIONS.DEPARTMENT_READ,
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.ANNOUNCEMENT_READ,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.ATTENDANCE_APPROVE,
  ],
  Employee: [PERMISSIONS.DEPARTMENT_READ, PERMISSIONS.ANNOUNCEMENT_READ],
};
