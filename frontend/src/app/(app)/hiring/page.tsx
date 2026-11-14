"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Briefcase, CalendarPlus, Download, UserPlus, Users } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import type { CandidateStage, Department, Employee, Interview, JobApplication, JobPosting } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { AccessNotice, type AccessResult } from "@/components/AccessNotice";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { saveFile } from "@/lib/native";
import { formatCalendarDate, formatDateTime, localIsoDate } from "@/components/format";

/**
 * Hiring (05). Authorized HR/Admin only.
 *
 * A candidate is a person; an application is that person applying to one job.
 * The same person can apply to several jobs without a duplicate record, and
 * stages belong to the application, not the person.
 */

type Tab = "jobs" | "candidates" | "interviews";

const TABS: { key: Tab; label: string }[] = [
  { key: "jobs", label: "Job openings" },
  { key: "candidates", label: "Candidates" },
  { key: "interviews", label: "Interviews" },
];

/** Selected is not Joined: joining is confirmed explicitly, never by a dropdown. */
const STAGES: CandidateStage[] = ["APPLIED", "SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"];

export default function HiringPage() {
  return (
    <Suspense fallback={<LoadingRows rows={5} />}>
      <Hiring />
    </Suspense>
  );
}

function Hiring() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = TABS.some((t) => t.key === requested) ? (requested as Tab) : "jobs";

  return (
    <div className="space-y-6">
      <PageHeader icon={Briefcase} title="Hiring" description="Job openings, candidates and interviews." />

      <div className="c-tabs" role="tablist" aria-label="Hiring">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => router.replace(t.key === "jobs" ? "/hiring" : `/hiring?tab=${t.key}`, { scroll: false })}
            className="c-tab"
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "jobs" && <JobsTab />}
      {tab === "candidates" && <CandidatesTab />}
      {tab === "interviews" && <InterviewsTab />}
    </div>
  );
}

/* ─── 5.1 Job openings ───────────────────────────────────────────────── */

function JobsTab() {
  const { toast } = useFeedback();
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPostings(await apiFetch<JobPosting[]>("/hiring/postings"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function setStatus(posting: JobPosting, status: JobPosting["status"]) {
    setBusyId(posting.id);
    try {
      await apiFetch(`/hiring/postings/${posting.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex justify-end">
        <Button variant={showForm ? "secondary" : "primary"} icon={showForm ? undefined : Briefcase} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close form" : "Add job opening"}
        </Button>
      </div>

      {showForm && (
        <JobForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Job opening added");
            load();
          }}
        />
      )}

      {postings.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="No job openings" description="Add one to start collecting candidates." />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">Job openings</caption>
            <thead>
              <tr>
                <th>Title</th>
                <th>Department</th>
                <th>Location</th>
                <th>Hiring owner</th>
                <th>Candidates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {postings.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-heading">{p.title}</td>
                  <td className="text-secondary">{p.department?.name ?? "—"}</td>
                  <td className="text-secondary">
                    {[p.location, p.workMode].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="text-secondary">
                    {p.hiringOwner ? `${p.hiringOwner.firstName} ${p.hiringOwner.lastName}` : "—"}
                  </td>
                  <td className="text-secondary">{p._count?.applications ?? 0}</td>
                  <td>
                    <select
                      aria-label={`Status for ${p.title}`}
                      value={p.status}
                      disabled={busyId === p.id}
                      onChange={(e) => setStatus(p, e.target.value as JobPosting["status"])}
                      className="c-select"
                    >
                      <option value="OPEN">Open</option>
                      <option value="ON_HOLD">On hold</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function JobForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    departmentId: "",
    location: "",
    workMode: "",
    hiringOwnerId: "",
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<Department[]>("/departments").then(setDepartments).catch(() => {});
    apiFetch<Employee[]>("/employees?status=active").then(setEmployees).catch(() => {});
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/hiring/postings", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          ...(form.departmentId ? { departmentId: form.departmentId } : {}),
          ...(form.location ? { location: form.location } : {}),
          ...(form.workMode ? { workMode: form.workMode } : {}),
          ...(form.hiringOwnerId ? { hiringOwnerId: form.hiringOwnerId } : {}),
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="job-title" className="c-label">
            Job title
          </label>
          <input id="job-title" required value={form.title} onChange={(e) => set("title", e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="job-department" className="c-label">
            Department
          </label>
          <select id="job-department" value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)} className="c-select">
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="job-location" className="c-label">
            Location
          </label>
          <input id="job-location" value={form.location} onChange={(e) => set("location", e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="job-mode" className="c-label">
            Work mode
          </label>
          <select id="job-mode" value={form.workMode} onChange={(e) => set("workMode", e.target.value)} className="c-select">
            <option value="">Not set</option>
            <option value="ONSITE">On site</option>
            <option value="HYBRID">Hybrid</option>
            <option value="REMOTE">Remote</option>
          </select>
        </div>
        <div>
          <label htmlFor="job-owner" className="c-label">
            Hiring owner
          </label>
          <select id="job-owner" value={form.hiringOwnerId} onChange={(e) => set("hiringOwnerId", e.target.value)} className="c-select">
            <option value="">Not assigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="job-description" className="c-label">
            Description
          </label>
          <textarea
            id="job-description"
            required
            rows={4}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="c-textarea"
          />
        </div>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Add opening
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ─── 5.2 Candidates ─────────────────────────────────────────────────── */

function CandidatesTab() {
  const { toast } = useFeedback();
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterJob, setFilterJob] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [joining, setJoining] = useState<JobApplication | null>(null);
  const [scheduling, setScheduling] = useState<JobApplication | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = new URLSearchParams();
      if (filterJob) query.set("jobPostingId", filterJob);
      if (filterStage) query.set("stage", filterStage);
      if (search) query.set("search", search);
      const qs = query.toString();
      const [apps, jobs] = await Promise.all([
        apiFetch<JobApplication[]>(`/hiring/candidates${qs ? `?${qs}` : ""}`),
        apiFetch<JobPosting[]>("/hiring/postings"),
      ]);
      setApplications(apps);
      setPostings(jobs);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filterJob, filterStage, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reloads when a filter changes
    load();
  }, [load]);

  async function moveStage(app: JobApplication, stage: CandidateStage) {
    setBusyId(app.id);
    try {
      await apiFetch(`/hiring/applications/${app.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function downloadResume(app: JobApplication) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"}/hiring/candidates/${app.candidate.id}/resume`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken") ?? ""}` } },
      );
      if (!res.ok) throw new Error();
      await saveFile(await res.blob(), app.candidate.resumeFileName ?? "resume");
    } catch {
      toast.error("Couldn't download that resume.");
    }
  }

  if (loading) return <LoadingRows rows={5} />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-44 flex-1">
          <label htmlFor="cand-search" className="c-label">
            Search
          </label>
          <input
            id="cand-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email…"
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="cand-job" className="c-label">
            Job
          </label>
          <select id="cand-job" value={filterJob} onChange={(e) => setFilterJob(e.target.value)} className="c-select">
            <option value="">All</option>
            {postings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cand-stage" className="c-label">
            Stage
          </label>
          <select id="cand-stage" value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="c-select">
            <option value="">All</option>
            {[...STAGES, "JOINED"].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <Button variant={showForm ? "secondary" : "primary"} icon={showForm ? undefined : UserPlus} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close form" : "Add candidate"}
        </Button>
      </div>

      {showForm && (
        <CandidateForm
          postings={postings}
          onCreated={(warning) => {
            setShowForm(false);
            toast.success(warning ?? "Candidate added");
            load();
          }}
        />
      )}

      {applications.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No candidates" description="Add a candidate to a job opening to get started." />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">Candidate applications</caption>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Job</th>
                <th>Contact</th>
                <th>Stage</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium text-heading">
                    {a.candidate.firstName} {a.candidate.lastName}
                    {a.candidate.resumeFileName && (
                      <Button variant="ghost" size="sm" icon={Download} onClick={() => downloadResume(a)}>
                        <span className="sr-only">Resume</span>
                      </Button>
                    )}
                  </td>
                  <td className="text-secondary">{a.jobPosting.title}</td>
                  <td className="text-secondary">
                    {a.candidate.email}
                    {a.candidate.phone ? ` · ${a.candidate.phone}` : ""}
                  </td>
                  <td>
                    {a.stage === "JOINED" ? (
                      <StatusBadge status="JOINED" />
                    ) : (
                      <select
                        aria-label={`Stage for ${a.candidate.firstName}`}
                        value={a.stage}
                        disabled={busyId === a.id}
                        onChange={(e) => moveStage(a, e.target.value as CandidateStage)}
                        className="c-select"
                      >
                        {STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" icon={CalendarPlus} onClick={() => setScheduling(a)}>
                        Interview
                      </Button>
                      {a.stage === "SELECTED" && (
                        <Button size="sm" onClick={() => setJoining(a)}>
                          Confirm joining
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {joining && (
        <ConfirmJoiningDialog
          application={joining}
          onClose={() => setJoining(null)}
          onDone={() => {
            setJoining(null);
            load();
          }}
        />
      )}
      {scheduling && (
        <ScheduleInterviewDialog
          application={scheduling}
          onClose={() => setScheduling(null)}
          onDone={() => {
            setScheduling(null);
            toast.success("Interview scheduled");
            load();
          }}
        />
      )}
    </div>
  );
}

function CandidateForm({ postings, onCreated }: { postings: JobPosting[]; onCreated: (warning?: string) => void }) {
  const [form, setForm] = useState({ jobPostingId: "", firstName: "", lastName: "", email: "", phone: "", source: "" });
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let resumePayload;
      if (resume) {
        const bytes = new Uint8Array(await resume.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        resumePayload = {
          fileName: resume.name,
          mimeType: resume.type || "application/octet-stream",
          contentBase64: btoa(binary),
        };
      }
      const res = await apiFetch<{ duplicateWarning: { message: string } | null }>("/hiring/candidates", {
        method: "POST",
        body: JSON.stringify({
          jobPostingId: form.jobPostingId,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.source ? { source: form.source } : {}),
          ...(resumePayload ? { resume: resumePayload } : {}),
        }),
      });
      onCreated(res.duplicateWarning?.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const openJobs = postings.filter((p) => p.status === "OPEN");

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="cand-posting" className="c-label">
            Applied job
          </label>
          <select id="cand-posting" required value={form.jobPostingId} onChange={(e) => set("jobPostingId", e.target.value)} className="c-select">
            <option value="">Choose a job opening</option>
            {openJobs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cand-first" className="c-label">
            First name
          </label>
          <input id="cand-first" required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="cand-last" className="c-label">
            Last name
          </label>
          <input id="cand-last" required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="cand-email" className="c-label">
            Email
          </label>
          <input id="cand-email" required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="cand-phone" className="c-label">
            Phone
          </label>
          <input id="cand-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="cand-source" className="c-label">
            Source
          </label>
          <input id="cand-source" value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="e.g. referral" className="c-input" />
        </div>
        <div>
          <label htmlFor="cand-resume" className="c-label">
            Resume <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input
            id="cand-resume"
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            className="c-input"
          />
        </div>
        <p className="text-xs text-secondary sm:col-span-2">
          An email that already belongs to a candidate adds a new application to the same person, not a duplicate record.
        </p>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting} disabled={!form.jobPostingId}>
            Add candidate
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ─── 5.4 Convert to employee ────────────────────────────────────────── */

function ConfirmJoiningDialog({
  application,
  onClose,
  onDone,
}: {
  application: JobApplication;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useFeedback();
  const [dateOfJoining, setDateOfJoining] = useState(localIsoDate());
  const [designation, setDesignation] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Department[]>("/departments").then(setDepartments).catch(() => {});
    apiFetch<Employee[]>("/employees?status=active").then(setEmployees).catch(() => {});
  }, []);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<AccessResult & { reusedExistingEmployee: boolean }>(
        `/hiring/applications/${application.id}/confirm-joining`,
        {
          method: "POST",
          body: JSON.stringify({
            dateOfJoining,
            ...(designation ? { designation } : {}),
            ...(departmentId ? { departmentId } : {}),
            ...(managerId ? { managerId } : {}),
          }),
        },
      );
      setAccess({ ...res, email: application.candidate.email });
      toast.success(res.reusedExistingEmployee ? "Linked to the existing employee record" : "Employee created");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-dialog z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Confirm joining" className="c-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="c-dialog-title">
          Confirm joining · {application.candidate.firstName} {application.candidate.lastName}
        </h2>
        <p className="mt-1 text-sm text-secondary">{application.jobPosting.title}</p>

        {access ? (
          <div className="mt-4 space-y-4">
            <AccessNotice result={access} kind="created" />
            <p className="text-xs text-secondary">
              Salary, payroll and any extra access are separate steps: set them up in Payroll and Settings.
            </p>
            <div className="flex justify-end">
              <Button onClick={onDone}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={confirm} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="join-date" className="c-label">
                Joining date
              </label>
              <input id="join-date" required type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} className="c-input" />
            </div>
            <div>
              <label htmlFor="join-designation" className="c-label">
                Designation
              </label>
              <input id="join-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} className="c-input" />
            </div>
            <div>
              <label htmlFor="join-department" className="c-label">
                Department
              </label>
              <select id="join-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="c-select">
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="join-manager" className="c-label">
                Manager
              </label>
              <select id="join-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)} className="c-select">
                <option value="">No manager</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-secondary sm:col-span-2">
              This creates the employee record, their login invitation and the joining checklist — once. It does not set salary
              or payroll.
            </p>
            {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" loading={busy}>
                Confirm joining
              </Button>
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─── 5.3 Interviews ─────────────────────────────────────────────────── */

function ScheduleInterviewDialog({
  application,
  onClose,
  onDone,
}: {
  application: JobApplication;
  onClose: () => void;
  onDone: () => void;
}) {
  const [interviewerId, setInterviewerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Employee[]>("/employees?status=active").then(setEmployees).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/hiring/applications/${application.id}/interviews`, {
        method: "POST",
        body: JSON.stringify({
          interviewerId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          ...(location ? { location } : {}),
          ...(meetingLink ? { meetingLink } : {}),
        }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-dialog z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Schedule interview" className="c-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="c-dialog-title">
          Schedule an interview · {application.candidate.firstName} {application.candidate.lastName}
        </h2>
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="int-interviewer" className="c-label">
              Interviewer
            </label>
            <select id="int-interviewer" required value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)} className="c-select">
              <option value="">Choose</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="int-when" className="c-label">
              Date and time
            </label>
            <input
              id="int-when"
              required
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="c-input"
            />
          </div>
          <div>
            <label htmlFor="int-location" className="c-label">
              Location <span className="font-normal text-secondary">(optional)</span>
            </label>
            <input id="int-location" value={location} onChange={(e) => setLocation(e.target.value)} className="c-input" />
          </div>
          <div>
            <label htmlFor="int-link" className="c-label">
              Meeting link <span className="font-normal text-secondary">(optional)</span>
            </label>
            <input id="int-link" type="url" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} className="c-input" />
          </div>
          <p className="text-xs text-secondary sm:col-span-2">
            Times are shown in the organization&apos;s time zone. The interviewer is notified by email.
          </p>
          {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={busy}>
              Schedule
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InterviewsTab() {
  const { toast } = useFeedback();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<Interview | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInterviews(await apiFetch<Interview[]>("/hiring/interviews"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  if (loading) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {interviews.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarPlus} title="No interviews scheduled" description="Schedule one from the Candidates tab." />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">Scheduled interviews</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>Candidate</th>
                <th>Role</th>
                <th>Interviewer</th>
                <th>Decision</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {interviews.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap font-medium text-heading">{formatDateTime(i.scheduledAt)}</td>
                  <td className="text-secondary">
                    {i.application ? `${i.application.candidate.firstName} ${i.application.candidate.lastName}` : "—"}
                  </td>
                  <td className="text-secondary">{i.application?.jobPosting.title ?? "—"}</td>
                  <td className="text-secondary">
                    {i.interviewer ? `${i.interviewer.firstName} ${i.interviewer.lastName}` : "—"}
                  </td>
                  <td className="text-secondary">{i.decision ?? "Pending"}</td>
                  <td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setFeedbackFor(i)}>
                      {i.feedback ? "View feedback" : "Add feedback"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {feedbackFor && (
        <FeedbackDialog
          interview={feedbackFor}
          onClose={() => setFeedbackFor(null)}
          onSaved={() => {
            setFeedbackFor(null);
            toast.success("Feedback saved");
            load();
          }}
        />
      )}
    </div>
  );
}

function FeedbackDialog({ interview, onClose, onSaved }: { interview: Interview; onClose: () => void; onSaved: () => void }) {
  const [feedback, setFeedback] = useState(interview.feedback ?? "");
  const [decision, setDecision] = useState(interview.decision ?? "PROCEED");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/hiring/interviews/${interview.id}`, { method: "PATCH", body: JSON.stringify({ feedback, decision }) });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-dialog z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Interview feedback" className="c-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="c-dialog-title">Interview feedback</h2>
        <p className="mt-1 text-sm text-secondary">
          {interview.application
            ? `${interview.application.candidate.firstName} ${interview.application.candidate.lastName} · ${interview.application.jobPosting.title}`
            : ""}
          {" · "}
          {formatCalendarDate(interview.scheduledAt)}
        </p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="fb-notes" className="c-label">
              Notes
            </label>
            <textarea id="fb-notes" required rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} className="c-textarea" />
          </div>
          <div>
            <label htmlFor="fb-decision" className="c-label">
              Decision
            </label>
            <select id="fb-decision" value={decision} onChange={(e) => setDecision(e.target.value)} className="c-select">
              <option value="PROCEED">Proceed</option>
              <option value="HOLD">Hold</option>
              <option value="REJECT">Reject</option>
            </select>
          </div>
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Save feedback
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
