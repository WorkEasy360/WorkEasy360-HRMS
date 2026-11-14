import "dotenv/config";
import "express-async-errors";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { prisma } from "./config/prisma";
import { errorHandler } from "./middleware/errorHandler";
import { rateLimit } from "./middleware/rateLimit";
import announcementsRoutes from "./modules/announcements/announcements.routes";
import assistantRoutes from "./modules/assistant/assistant.routes";
import attendanceRoutes from "./modules/attendance/attendance.routes";
import auditRoutes from "./modules/audit/audit.routes";
import automationRoutes from "./modules/automation/automation.routes";
import authRoutes from "./modules/auth/auth.routes";
import compensationRoutes from "./modules/compensation/compensation.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import departmentsRoutes from "./modules/departments/departments.routes";
import documentsRoutes from "./modules/documents/documents.routes";
import employeesRoutes from "./modules/employees/employees.routes";
import helpdeskRoutes from "./modules/helpdesk/helpdesk.routes";
import integrationsRoutes from "./modules/integrations/integrations.routes";
import leaveRequestsRoutes from "./modules/leaveRequests/leaveRequests.routes";
import leaveTypesRoutes from "./modules/leaveTypes/leaveTypes.routes";
import onboardingRoutes from "./modules/onboarding/onboarding.routes";
import organizationsRoutes from "./modules/organizations/organizations.routes";
import payrollRoutes from "./modules/payroll/payroll.routes";
import policiesRoutes from "./modules/policies/policies.routes";
import recruitmentRoutes from "./modules/recruitment/recruitment.routes";
import rolesRoutes from "./modules/roles/roles.routes";
import { verifyAssistantConfig } from "./ai/config";
import { seedPermissions } from "./utils/seedPermissions";

const app = express();

const isProduction = process.env.NODE_ENV === "production";

// Behind a reverse proxy, set TRUST_PROXY (e.g. "1") so rate limits see the real client IP.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.disable("x-powered-by");

app.use(helmet());
// CORS_ORIGIN may list several origins separated by commas (e.g. the app domain and a staging domain).
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
app.use(cors({ origin: corsOrigins, maxAge: 600 }));
app.use(express.json({ limit: "100kb" }));
app.use(morgan(isProduction ? "combined" : "dev"));

// Brute-force protection for sign-in style endpoints, plus a generous ceiling for the rest of the API.
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, message: "Too many attempts. Please wait a minute and try again." });
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Too many sign-ups from this network. Try again later." });
app.use(
  [
    "/api/auth/login",
    "/api/auth/2fa/login-verify",
    "/api/auth/change-password",
    "/api/auth/2fa/disable",
    "/api/auth/forgot-password",
    "/api/auth/password-token",
    "/api/auth/reset-password",
  ],
  authLimiter,
);
app.use("/api/auth/register", registerLimiter);
app.use("/api", rateLimit({ windowMs: 60_000, max: 600, message: "Too many requests. Please slow down." }));

// Readiness: 503 when the database is unreachable, so Docker/nginx/monitoring see a real outage.
async function health(_req: express.Request, res: express.Response) {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "error", database: "down" });
  }
}
app.get("/health", health);
app.get("/api/health", health);

app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/departments", departmentsRoutes);
app.use("/api/employees", employeesRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave-types", leaveTypesRoutes);
app.use("/api/leave-requests", leaveRequestsRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/policies", policiesRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/compensation", compensationRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/helpdesk", helpdeskRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/automation", automationRoutes);
app.use("/api/integrations", integrationsRoutes);
app.use("/api/hiring", recruitmentRoutes);
app.use("/api/assistant", assistantRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
seedPermissions()
  .then(() => {
    // Fails the boot, not the first question, when AI_PROVIDER is set without a key.
    verifyAssistantConfig();
    const server = app.listen(port, () => {
      console.log(`WorkEasy360 API listening on port ${port}`);
    });

    // ECS/Beanstalk send SIGTERM before replacing a task: finish in-flight requests, then close DB connections.
    const shutdown = (signal: string) => {
      console.log(`${signal} received, shutting down`);
      server.close(() => {
        prisma.$disconnect().finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("Failed to seed permission catalog", err);
    process.exit(1);
  });
