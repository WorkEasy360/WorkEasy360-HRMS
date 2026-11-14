export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Work schedule (Settings 7.1.2). */
  timezone: string;
  /** ISO weekday numbers: 1 = Monday .. 7 = Sunday. */
  workingDays: number[];
  workStartTime: string;
  workEndTime: string;
  fullDayHours: number;
}

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
}

export type EmployeeStatus = "ACTIVE" | "ONBOARDING" | "ON_LEAVE" | "EXITED";

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  phone: string | null;
  departmentId: string | null;
  department?: Department | null;
  managerId: string | null;
  manager?: Employee | null;
  dateOfJoining: string | null;
  status: EmployeeStatus;
  user?: { email: string };
  // Personal details — only returned to the employee themselves and to HR.
  dateOfBirth?: string | null;
  personalEmail?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  // Exit (Employees 2.4). History is kept; only access stops.
  exitDate?: string | null;
  exitReason?: string | null;
  exitRecordedAt?: string | null;
  accessRevokedAt?: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  organizationId: string;
  employee: Employee | null;
  roles: string[];
  permissions: string[];
  totpEnabled: boolean;
  mustChangePassword?: boolean;
}

/* ─── Attendance & Leave ─────────────────────────────────────────────── */

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

/**
 * How one day is counted. NOT_CHECKED_IN is deliberately distinct from ABSENT:
 * a working day only becomes absent once it has finished.
 */
export type DayStatus = "HOLIDAY" | "WEEKLY_OFF" | "ON_LEAVE" | "PRESENT" | "NOT_CHECKED_IN" | "ABSENT";

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface WorkSchedule {
  timezone: string;
  workingDays: number[];
  workStartTime: string;
  workEndTime: string;
  fullDayHours: number;
  holidays: { date: string; name: string }[];
  leaveTypes: LeaveType[];
}

export interface AttendanceRegister {
  date: string;
  isWorkingDay: boolean;
  holiday: string | null;
  rows: {
    employeeId: string;
    name: string;
    employeeCode: string;
    department: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    missingCheckOut: boolean;
    status: DayStatus;
  }[];
}

export interface AttendanceSummary {
  month: string;
  employeeId: string;
  workingDays: number;
  HOLIDAY: number;
  WEEKLY_OFF: number;
  ON_LEAVE: number;
  PRESENT: number;
  NOT_CHECKED_IN: number;
  ABSENT: number;
  records: { date: string; checkInAt: string | null; checkOutAt: string | null }[];
}

export type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  date: string;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  reason: string;
  status: CorrectionStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  /** Set when no approver is configured, so the gap is visible. */
  routingNote: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
  approver?: { firstName: string; lastName: string } | null;
}

export interface LeaveType {
  id: string;
  name: string;
  defaultDaysPerYear: number;
  /** Unpaid leave reduces paid days in payroll. */
  paid: boolean;
}

export type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  decisionNote: string | null;
  routingNote: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

/* ─── Home content ───────────────────────────────────────────────────── */

export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  author: { firstName: string; lastName: string };
}

export interface HrPolicy {
  id: string;
  title: string;
  body?: string;
  category: string | null;
  publishedAt: string | null;
  updatedAt: string;
  author: { id: string; firstName: string; lastName: string };
}

export interface OnboardingTask {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  requiresVerification: boolean;
  verifiedAt: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

/* ─── Documents ──────────────────────────────────────────────────────── */

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  title: string;
  category: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  verifiedAt: string | null;
  createdAt: string;
  uploadedBy: { id: string; firstName: string; lastName: string } | null;
  verifiedBy: { id: string; firstName: string; lastName: string } | null;
}

/* ─── Payroll ────────────────────────────────────────────────────────── */

export interface CompensationRecord {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  annualCTC: number;
  monthlyGross: number;
  currency: string;
}

export type PayrollRunStatus = "DRAFT" | "FINALIZED";

export interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  finalizedAt: string | null;
  finalizedById: string | null;
  _count?: { payslips: number };
}

export interface Payslip {
  id: string;
  employeeId: string;
  payrollRunId: string;
  grossPay: number;
  deductions: number;
  netPay: number;
  payableDays: number;
  paidDays: number;
  calculationInputs: Record<string, unknown> | null;
  /** Published means readable by the employee. It is not a payment. */
  publishedAt: string | null;
  revisionNumber: number;
  revisionOfId: string | null;
  revisionNote: string | null;
  supersededAt: string | null;
  createdAt: string;
  payrollRun?: { month: number; year: number; status: PayrollRunStatus };
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

/* ─── Helpdesk ───────────────────────────────────────────────────────── */

export type TicketType = "HR_QUESTION" | "PRODUCT_PROBLEM";
export type TicketQueue = "HR" | "PAYROLL" | "PRODUCT";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";

export interface HelpDeskTicket {
  id: string;
  reference: string;
  type: TicketType;
  queue: TicketQueue;
  subject: string;
  description?: string;
  status: TicketStatus;
  assignedToId?: string | null;
  reopenRequestedAt: string | null;
  escalatedFromId: string | null;
  escalationSummary?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  employee?: { id: string; firstName: string; lastName: string; employeeCode: string };
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  escalations?: { id: string; reference: string; status: TicketStatus; queue: TicketQueue }[];
  escalatedFrom?: { id: string; reference: string } | null;
}

export interface HelpDeskReply {
  id: string;
  ticketId: string;
  body: string;
  internal: boolean;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string };
}

/* ─── Hiring ─────────────────────────────────────────────────────────── */

export type JobPostingStatus = "OPEN" | "ON_HOLD" | "CLOSED";

export interface JobPosting {
  id: string;
  title: string;
  description: string;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  location: string | null;
  workMode: string | null;
  hiringOwnerId: string | null;
  hiringOwner?: { id: string; firstName: string; lastName: string } | null;
  status: JobPostingStatus;
  _count?: { applications: number };
}

export type CandidateStage = "APPLIED" | "SHORTLISTED" | "INTERVIEW" | "SELECTED" | "REJECTED" | "JOINED";

export interface Interview {
  id: string;
  interviewerId?: string;
  interviewer?: { id: string; firstName: string; lastName: string };
  scheduledAt: string;
  location: string | null;
  meetingLink: string | null;
  feedback: string | null;
  decision: string | null;
  application?: {
    id: string;
    stage?: CandidateStage;
    candidate: { id?: string; firstName: string; lastName: string };
    jobPosting: { title: string };
  };
}

/** The person. One row, reused across every job they apply to. */
export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string | null;
  notes: string | null;
  resumeFileName: string | null;
  resumeMimeType?: string | null;
  createdAt: string;
  applications?: JobApplication[];
}

/** One candidate applying to one job. Stage and interviews live here. */
export interface JobApplication {
  id: string;
  stage: CandidateStage;
  notes: string | null;
  joinedAt: string | null;
  hiredEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
  jobPosting: { id: string; title: string; status: JobPostingStatus };
  hiringOwner: { id: string; firstName: string; lastName: string } | null;
  candidate: Candidate;
  interviews?: Interview[];
  _count?: { interviews: number };
}

/* ─── Settings ───────────────────────────────────────────────────────── */

export interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface OrgMember {
  userId: string;
  email: string;
  employeeId: string | null;
  name: string;
  employeeCode: string | null;
  employeeStatus: EmployeeStatus | null;
  accessRevoked: boolean;
  roles: { id: string; name: string }[];
  occupiesSeat: boolean;
}

export interface MembersResponse {
  members: OrgMember[];
  seatsInUse: number;
  employeeRecords: number;
  note: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor?: { email: string } | null;
}

/** One supported internal rule (Settings 7.5), with its switch and timing. */
export interface AutomationRule {
  key: string;
  label: string;
  description: string;
  timingOptions: number[] | null;
  enabled: boolean;
  timingHours: number | null;
}

/* ─── Integrations, powered by WorkEasy Connect ──────────────────────── */

export type IntegrationDirection = "INBOUND" | "OUTBOUND";
export type IntegrationConnectionStatus = "DRAFT" | "ACTIVE" | "DISABLED" | "COMING_SOON";

export interface IntegrationMapping {
  id: string;
  connectionId: string;
  direction: IntegrationDirection;
  eventKey: string | null;
  actionKey: string | null;
  destination: string | null;
  fieldMap: Record<string, string>;
  enabled: boolean;
}

export interface IntegrationConnection {
  id: string;
  name: string;
  provider: string;
  direction: IntegrationDirection;
  status: IntegrationConnectionStatus;
  connectUrl: string | null;
  connectRef: string | null;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  mappings: IntegrationMapping[];
  _count?: { transfers: number };
}

export interface IntegrationTransfer {
  id: string;
  direction: IntegrationDirection;
  reference: string;
  status: string;
  message: string | null;
  occurredAt: string;
  connection: { id: string; name: string; provider: string };
  mapping: { id: string; eventKey: string | null; actionKey: string | null } | null;
}

export interface IntegrationCatalog {
  connectBaseUrl: string;
  connectors: { provider: string; label: string; direction: string; released: boolean; status: string }[];
  events: { key: string; label: string; fields: string[] }[];
  actions: { key: string; label: string; fields: string[]; note?: string }[];
}
