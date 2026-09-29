"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { BriefcaseBusiness, CalendarClock, MousePointerClick, Plus, UserCheck, UserPlus, Users } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Candidate, Department, Employee, JobPosting } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateTime } from "@/components/format";
import { AccessNotice, type AccessResult } from "@/components/AccessNotice";

const STAGES: Candidate["stage"][] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];

function stageLabel(stage: string) {
  return stage.charAt(0) + stage.slice(1).toLowerCase();
}

export default function RecruitmentPage() {
  const { toast, confirm } = useFeedback();
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPostingForm, setShowPostingForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Refreshes postings/employees in place — never toggles `loading`, so it
  // doesn't unmount the candidates panel (and any open form's local state)
  // when called as a background refresh after an action.
  async function loadPostings() {
    const [p, e] = await Promise.all([
      apiFetch<JobPosting[]>("/recruitment/postings"),
      apiFetch<Employee[]>("/employees"),
    ]);
    setPostings(p);
    setEmployees(e);
  }

  function refreshPostings() {
    loadPostings().catch((err) => toast.error(errorMessage(err)));
  }

  // `initial` shows a skeleton only when switching postings; background
  // refreshes keep candidate cards mounted (e.g. the hire form's temp password).
  async function loadCandidates(postingId: string, initial = false) {
    if (initial) setCandidatesLoading(true);
    try {
      setCandidates(await apiFetch<Candidate[]>(`/recruitment/candidates?jobPostingId=${postingId}`));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      if (initial) setCandidatesLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    loadPostings()
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedPostingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on selection change
      loadCandidates(selectedPostingId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when the selection changes
  }, [selectedPostingId]);

  async function toggleStatus(posting: JobPosting) {
    const closing = posting.status === "OPEN";
    if (closing) {
      const ok = await confirm({
        title: `Close “${posting.title}”?`,
        description: "The posting will stop accepting new candidates. You can reopen it later.",
        confirmLabel: "Close posting",
        destructive: true,
      });
      if (!ok) return;
    }
    setTogglingId(posting.id);
    try {
      await apiFetch(`/recruitment/postings/${posting.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: closing ? "CLOSED" : "OPEN" }),
      });
      toast.success(closing ? "Job posting closed" : "Job posting reopened");
      refreshPostings();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  const selectedPosting = postings.find((p) => p.id === selectedPostingId);
  const openCount = postings.filter((p) => p.status === "OPEN").length;
  const totalCandidates = postings.reduce((sum, p) => sum + (p._count?.candidates ?? 0), 0);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Recruitment"
        description="Publish job postings, track candidates through each stage and hire."
        actions={
          <Button
            variant={showPostingForm ? "secondary" : "primary"}
            icon={showPostingForm ? undefined : Plus}
            onClick={() => setShowPostingForm((v) => !v)}
          >
            {showPostingForm ? "Close form" : "New job posting"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showPostingForm && (
        <PostingForm
          onCreated={() => {
            setShowPostingForm(false);
            toast.success("Job posting published");
            refreshPostings();
          }}
        />
      )}

      {!loading && postings.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="Open postings" value={openCount} tone="text-emerald-600" />
          <SummaryTile label="Closed" value={postings.length - openCount} tone="text-slate-500" />
          <SummaryTile label="Candidates" value={totalCandidates} tone="text-slate-900" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={4} />
      ) : postings.length === 0 ? (
        <Card>
          <EmptyState
            icon={BriefcaseBusiness}
            title="No job postings yet"
            description="Create a job posting to start adding candidates and scheduling interviews."
            action={
              !showPostingForm && (
                <Button icon={Plus} onClick={() => setShowPostingForm(true)}>
                  New job posting
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">Job postings</h2>
            {postings.map((p) => {
              const selected = selectedPostingId === p.id;
              const count = p._count?.candidates ?? 0;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => setSelectedPostingId(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedPostingId(p.id);
                  }}
                  className={`block w-full cursor-pointer rounded-xl border bg-white p-4 text-left shadow-sm transition ${
                    selected ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{p.title}</p>
                      {p.department?.name && <p className="text-xs text-slate-500">{p.department.name}</p>}
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {count} candidate{count === 1 ? "" : "s"}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={togglingId === p.id}
                      className={p.status === "OPEN" ? "text-red-600 hover:bg-red-50 hover:text-red-700" : "text-blue-600 hover:bg-blue-50"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStatus(p);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {p.status === "OPEN" ? "Close posting" : "Reopen"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-slate-500">
                {selectedPosting ? `Candidates — ${selectedPosting.title}` : "Candidates"}
              </h2>
              {selectedPosting && (
                <Button
                  variant={showCandidateForm ? "secondary" : "primary"}
                  size="sm"
                  icon={showCandidateForm ? undefined : UserPlus}
                  onClick={() => setShowCandidateForm((v) => !v)}
                >
                  {showCandidateForm ? "Close form" : "Add candidate"}
                </Button>
              )}
            </div>

            {!selectedPosting ? (
              <Card>
                <EmptyState
                  icon={MousePointerClick}
                  title="Select a job posting"
                  description="Choose a posting on the left to view its candidates, move them through stages and schedule interviews."
                />
              </Card>
            ) : (
              <>
                {showCandidateForm && (
                  <CandidateForm
                    jobPostingId={selectedPosting.id}
                    onCreated={() => {
                      setShowCandidateForm(false);
                      toast.success("Candidate added");
                      loadCandidates(selectedPosting.id);
                    }}
                  />
                )}
                {candidatesLoading ? (
                  <LoadingRows rows={3} />
                ) : candidates.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={UserPlus}
                      title="No candidates yet"
                      description="Add candidates who applied for this role to start tracking them through the pipeline."
                      action={
                        !showCandidateForm && (
                          <Button icon={UserPlus} onClick={() => setShowCandidateForm(true)}>
                            Add candidate
                          </Button>
                        )
                      }
                    />
                  </Card>
                ) : (
                  candidates.map((c) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      employees={employees}
                      onChanged={() => {
                        loadCandidates(selectedPosting.id);
                        refreshPostings();
                      }}
                    />
                  ))
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

function PostingForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [description, setDescription] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<Department[]>("/departments").then(setDepartments).catch(() => setDepartments([]));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/recruitment/postings", {
        method: "POST",
        body: JSON.stringify({ title, description, departmentId: departmentId || undefined }),
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
        <div className={departments.length > 0 ? "" : "sm:col-span-2"}>
          <label htmlFor="posting-title" className="label">
            Job title
          </label>
          <input
            id="posting-title"
            required
            placeholder="e.g. Senior Frontend Engineer"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
        </div>
        {departments.length > 0 && (
          <div>
            <label htmlFor="posting-department" className="label">
              Department <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <select id="posting-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="input">
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor="posting-description" className="label">
            Job description
          </label>
          <textarea
            id="posting-description"
            required
            placeholder="Responsibilities, requirements, location…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Post job
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CandidateForm({ jobPostingId, onCreated }: { jobPostingId: string; onCreated: () => void }) {
  const uid = useId();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/recruitment/candidates", {
        method: "POST",
        body: JSON.stringify({ jobPostingId, firstName, lastName, email, source: source || undefined }),
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
          <label htmlFor={`${uid}-first`} className="label">
            First name
          </label>
          <input id={`${uid}-first`} required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor={`${uid}-last`} className="label">
            Last name
          </label>
          <input id={`${uid}-last`} required value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-email`} className="label">
            Email
          </label>
          <input id={`${uid}-email`} required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-source`} className="label">
            Source <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={`${uid}-source`}
            placeholder="e.g. LinkedIn, referral"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" icon={UserPlus} loading={submitting}>
            Add candidate
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CandidateCard({
  candidate,
  employees,
  onChanged,
}: {
  candidate: Candidate;
  employees: Employee[];
  onChanged: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const stageId = useId();
  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [showHireForm, setShowHireForm] = useState(false);
  const [updatingStage, setUpdatingStage] = useState(false);
  const name = `${candidate.firstName} ${candidate.lastName}`;

  async function setStage(stage: Candidate["stage"]) {
    if (stage === "REJECTED") {
      const ok = await confirm({
        title: `Reject ${name}?`,
        description: "The candidate will be moved to the Rejected stage.",
        confirmLabel: "Reject candidate",
        destructive: true,
      });
      if (!ok) return;
    }
    setUpdatingStage(true);
    try {
      await apiFetch(`/recruitment/candidates/${candidate.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      toast.success(stage === "REJECTED" ? `${name} rejected` : `${name} moved to ${stageLabel(stage)}`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUpdatingStage(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{name}</p>
          <p className="break-all text-xs text-slate-500">
            {candidate.email} {candidate.source && `· ${candidate.source}`}
          </p>
          <div className="mt-1.5">
            <StatusBadge status={candidate.stage} />
          </div>
        </div>
        <div className="w-36">
          <label htmlFor={stageId} className="mb-1 block text-xs font-medium text-slate-500">
            Stage
          </label>
          <select
            id={stageId}
            value={candidate.stage}
            disabled={candidate.stage === "HIRED" || updatingStage}
            onChange={(e) => setStage(e.target.value as Candidate["stage"])}
            className="input py-1.5 text-xs"
          >
            {/* Hiring goes through "Confirm hire" (creates the employee), so HIRED is display-only. */}
            {STAGES.filter((s) => s !== "HIRED" || candidate.stage === "HIRED").map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {candidate.interviews && candidate.interviews.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {candidate.interviews.map((iv) => (
            <li key={iv.id} className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span>
                Interview {formatDateTime(iv.scheduledAt)}
                {iv.rating ? ` · rated ${iv.rating}/5` : " · pending feedback"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {candidate.stage !== "HIRED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={showInterviewForm ? "secondary" : "ghost"}
            size="sm"
            icon={CalendarClock}
            onClick={() => setShowInterviewForm((v) => !v)}
          >
            {showInterviewForm ? "Close" : "Schedule interview"}
          </Button>
          {candidate.stage === "OFFER" && (
            <Button
              variant={showHireForm ? "secondary" : "success"}
              size="sm"
              icon={UserCheck}
              onClick={() => setShowHireForm((v) => !v)}
            >
              {showHireForm ? "Close" : "Hire"}
            </Button>
          )}
        </div>
      )}

      {showInterviewForm && (
        <InterviewForm
          candidateId={candidate.id}
          employees={employees}
          onScheduled={() => {
            setShowInterviewForm(false);
            toast.success(`Interview scheduled with ${name}`);
            onChanged();
          }}
        />
      )}
      {showHireForm && (
        <HireForm
          candidateId={candidate.id}
          candidateName={name}
          onHired={() => {
            toast.success(`${name} hired`);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function InterviewForm({
  candidateId,
  employees,
  onScheduled,
}: {
  candidateId: string;
  employees: Employee[];
  onScheduled: () => void;
}) {
  const uid = useId();
  const [interviewerId, setInterviewerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/recruitment/candidates/${candidateId}/interviews`, {
        method: "POST",
        body: JSON.stringify({ interviewerId, scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-3 p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-interviewer`} className="label">
            Interviewer
          </label>
          <select id={`${uid}-interviewer`} required value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)} className="input">
            <option value="">Select interviewer…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-when`} className="label">
            Date &amp; time
          </label>
          <input
            id={`${uid}-when`}
            required
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" loading={submitting}>
            Schedule
          </Button>
        </div>
      </form>
    </Card>
  );
}

function HireForm({ candidateId, candidateName, onHired }: { candidateId: string; candidateName: string; onHired: () => void }) {
  const { confirm } = useFeedback();
  const uid = useId();
  const [designation, setDesignation] = useState("");
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: `Hire ${candidateName}?`,
      description: "This creates an employee record and login for the candidate. It can't be undone from here.",
      confirmLabel: "Hire candidate",
    });
    if (!ok) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<AccessResult>(`/recruitment/candidates/${candidateId}/hire`, {
        method: "POST",
        body: JSON.stringify({ designation: designation || undefined }),
      });
      setAccess(result);
      onHired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-3 p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-designation`} className="label">
            Designation <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={`${uid}-designation`}
            placeholder="e.g. Software Engineer"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        {access && <AccessNotice result={access} kind="hired" />}
        {!access && (
          <div className="sm:col-span-2">
            <Button type="submit" variant="success" size="sm" icon={UserCheck} loading={submitting}>
              Confirm hire
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
