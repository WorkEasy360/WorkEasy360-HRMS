export interface Organization {
  id: string;
  name: string;
  slug: string;
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

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export interface LeaveType {
  id: string;
  name: string;
  defaultDaysPerYear: number;
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
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  author: { firstName: string; lastName: string };
}

export interface OnboardingTask {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface ShiftAssignment {
  id: string;
  employeeId: string;
  shiftTemplateId: string;
  effectiveFrom: string;
  shiftTemplate: ShiftTemplate;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export type TimesheetStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface TimesheetEntry {
  id: string;
  employeeId: string;
  date: string;
  hours: number;
  task: string | null;
  status: TimesheetStatus;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export interface CompensationRecord {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  annualCTC: number;
  monthlyGross: number;
  currency: string;
}

export type PayrollRunStatus = "DRAFT" | "PROCESSED";

export interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  processedAt: string | null;
}

export interface Payslip {
  id: string;
  employeeId: string;
  grossPay: number;
  deductions: number;
  netPay: number;
  createdAt: string;
  payrollRun?: { month: number; year: number; status: PayrollRunStatus };
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export type ReviewCycleStatus = "DRAFT" | "ACTIVE" | "CLOSED";

export interface ReviewCycle {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: ReviewCycleStatus;
}

export type ReviewStatus = "PENDING" | "SELF_SUBMITTED" | "MANAGER_SUBMITTED" | "COMPLETED";

export interface PerformanceReview {
  id: string;
  cycleId: string;
  cycle: ReviewCycle;
  employeeId: string;
  reviewerId: string | null;
  selfAssessment: string | null;
  managerAssessment: string | null;
  rating: number | null;
  status: ReviewStatus;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export type GoalStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface Goal {
  id: string;
  employeeId: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  progress: number;
  dueDate: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface HelpDeskTicket {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: TicketStatus;
  assignedToId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  employee?: { firstName: string; lastName: string; employeeCode: string };
  assignedTo?: { firstName: string; lastName: string } | null;
}

export type AutomationTrigger = "LEAVE_APPROVED" | "EMPLOYEE_ONBOARDED" | "TIMESHEET_APPROVED";
export type AutomationActionType = "CREATE_ANNOUNCEMENT" | "ASSIGN_ONBOARDING_TASK";

export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
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

export interface HrGuideArticle {
  id: string;
  title: string;
  body: string;
  category: string | null;
  updatedAt: string;
  author: { firstName: string; lastName: string };
}

export interface HeadcountReport {
  total: number;
  byStatus: { status: EmployeeStatus; count: number }[];
  byDepartment: { department: string; count: number }[];
}

export interface AttritionReport {
  totalExits: number;
  byMonth: { month: string; count: number }[];
}

export interface LeaveLiabilityReport {
  year: number;
  byLeaveType: { leaveType: string; remainingDays: number; usedDays: number }[];
}

export interface PayrollCostReport {
  byRun: { month: number; year: number; grossTotal: number; netTotal: number; employeeCount: number }[];
}

export type JobPostingStatus = "OPEN" | "CLOSED";

export interface JobPosting {
  id: string;
  title: string;
  description: string;
  departmentId: string | null;
  department?: { name: string } | null;
  status: JobPostingStatus;
  _count?: { candidates: number };
}

export type CandidateStage = "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED";

export interface Interview {
  id: string;
  candidateId: string;
  interviewerId: string;
  scheduledAt: string;
  feedback: string | null;
  rating: number | null;
  candidate?: { firstName: string; lastName: string; jobPosting: { title: string } };
}

export interface Candidate {
  id: string;
  jobPostingId: string;
  jobPosting?: { title: string };
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string | null;
  stage: CandidateStage;
  notes: string | null;
  hiredEmployeeId: string | null;
  interviews?: Interview[];
}

export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED";

export interface ExpenseClaim {
  id: string;
  employeeId: string;
  category: string;
  amount: number;
  currency: string;
  expenseDate: string;
  description: string | null;
  status: ExpenseStatus;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export type AssetStatus = "AVAILABLE" | "ASSIGNED" | "RETIRED";

export interface Asset {
  id: string;
  name: string;
  category: string;
  serialNumber: string | null;
  status: AssetStatus;
  assignedToId: string | null;
  assignedTo?: { firstName: string; lastName: string; employeeCode: string } | null;
}

export type LoanStatus = "PENDING" | "APPROVED" | "REJECTED" | "ACTIVE" | "CLOSED";

export interface LoanRequest {
  id: string;
  employeeId: string;
  amount: number;
  reason: string | null;
  emiMonths: number;
  monthlyDeduction: number | null;
  remainingAmount: number | null;
  status: LoanStatus;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}
