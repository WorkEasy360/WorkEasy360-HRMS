"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClipboardCheck, ClipboardList, Plus, Star, Users } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PerformanceReview } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateRange } from "@/components/format";

export default function PerformancePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("performance:manage");
  const { toast } = useFeedback();

  const [myReviews, setMyReviews] = useState<PerformanceReview[]>([]);
  const [teamReviews, setTeamReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCycleForm, setShowCycleForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [mine, team] = await Promise.all([
        apiFetch<PerformanceReview[]>("/performance/reviews/me"),
        apiFetch<PerformanceReview[]>("/performance/reviews/team"),
      ]);
      setMyReviews(mine);
      setTeamReviews(team);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, []);

  const myOpen = myReviews.filter((r) => r.status === "PENDING").length;
  const teamOpen = teamReviews.filter((r) => r.status !== "COMPLETED").length;

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Performance"
        description="Complete your self-assessments and review the people who report to you."
        actions={
          canManage && (
            <Button
              variant={showCycleForm ? "secondary" : "primary"}
              icon={showCycleForm ? undefined : Plus}
              onClick={() => setShowCycleForm((v) => !v)}
            >
              {showCycleForm ? "Close form" : "New review cycle"}
            </Button>
          )
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showCycleForm && (
        <CycleForm
          onCreated={(name) => {
            setShowCycleForm(false);
            toast.success(`Review cycle "${name}" created`);
            load();
          }}
        />
      )}

      {!loading && (myReviews.length > 0 || teamReviews.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <SummaryTile label="Self-assessments due" value={myOpen} tone={myOpen ? "text-amber-600" : "text-slate-900"} />
          <SummaryTile label="Team reviews open" value={teamOpen} tone={teamOpen ? "text-amber-600" : "text-slate-900"} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">My reviews</h2>
        {loading ? (
          <LoadingRows rows={2} />
        ) : myReviews.length === 0 ? (
          <Card>
            <EmptyState
              icon={ClipboardList}
              title="No review cycles yet"
              description="When HR opens a review cycle, your review will appear here for you to write a self-assessment."
            />
          </Card>
        ) : (
          myReviews.map((r) => (
            <MyReviewCard
              key={r.id}
              review={r}
              onUpdated={() => {
                toast.success("Self-assessment submitted");
                load();
              }}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">Team reviews</h2>
        {loading ? (
          <LoadingRows rows={2} />
        ) : teamReviews.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="No team reviews to complete"
              description="Reviews for your direct reports will show up here during an active review cycle."
            />
          </Card>
        ) : (
          teamReviews.map((r) => (
            <TeamReviewCard
              key={r.id}
              review={r}
              onUpdated={() => {
                toast.success(`Review completed for ${r.employee?.firstName ?? "employee"}`);
                load();
              }}
            />
          ))
        )}
      </section>
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

function CycleForm({ onCreated }: { onCreated: (name: string) => void }) {
  const { confirm } = useFeedback();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: `Create review cycle "${name}"?`,
      description: "This opens a performance review for every active employee. This can't be undone from here.",
      confirmLabel: "Create cycle",
    });
    if (!ok) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/performance/cycles", { method: "POST", body: JSON.stringify({ name, startDate, endDate }) });
      onCreated(name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="cycle-name" className="label">
            Cycle name
          </label>
          <input id="cycle-name" required placeholder="e.g. H2 2026" value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="cycle-start" className="label">
            Start date
          </label>
          <input id="cycle-start" required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="cycle-end" className="label">
            End date
          </label>
          <input
            id="cycle-end"
            required
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Create cycle
          </Button>
          <p className="mt-2 text-xs text-slate-500">Creating a cycle opens reviews for all active employees.</p>
        </div>
      </form>
    </Card>
  );
}

function MyReviewCard({ review, onUpdated }: { review: PerformanceReview; onUpdated: () => void }) {
  const { toast } = useFeedback();
  const [selfAssessment, setSelfAssessment] = useState(review.selfAssessment ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await apiFetch(`/performance/reviews/me/${review.id}`, {
        method: "PATCH",
        body: JSON.stringify({ selfAssessment }),
      });
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const fieldId = `self-assessment-${review.id}`;

  return (
    <Card className="p-4">
      <ReviewHeader title={review.cycle.name} review={review} />
      {review.status === "COMPLETED" ? (
        <dl className="mt-3 space-y-2 text-sm">
          <AssessmentRow label="Self-assessment" value={review.selfAssessment} />
          <AssessmentRow label="Manager assessment" value={review.managerAssessment} />
          <Rating value={review.rating} />
        </dl>
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor={fieldId} className="label">
            Self-assessment
          </label>
          <textarea
            id={fieldId}
            value={selfAssessment}
            onChange={(e) => setSelfAssessment(e.target.value)}
            placeholder="Summarise your achievements, challenges and growth this cycle…"
            rows={3}
            className="input"
          />
          <Button size="sm" icon={ClipboardCheck} onClick={submit} loading={saving} disabled={!selfAssessment}>
            Submit self-assessment
          </Button>
        </div>
      )}
    </Card>
  );
}

function TeamReviewCard({ review, onUpdated }: { review: PerformanceReview; onUpdated: () => void }) {
  const { toast, confirm } = useFeedback();
  const [managerAssessment, setManagerAssessment] = useState(review.managerAssessment ?? "");
  const [rating, setRating] = useState(review.rating ?? 3);
  const [saving, setSaving] = useState(false);

  const employeeName = `${review.employee?.firstName ?? ""} ${review.employee?.lastName ?? ""}`.trim();

  async function submit() {
    const ok = await confirm({
      title: "Complete this review?",
      description: `${employeeName || "This employee"} will receive a rating of ${rating}/5 for ${review.cycle.name}.`,
      confirmLabel: "Complete review",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await apiFetch(`/performance/reviews/${review.id}/manager`, {
        method: "PATCH",
        body: JSON.stringify({ managerAssessment, rating }),
      });
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const assessmentId = `manager-assessment-${review.id}`;
  const ratingId = `manager-rating-${review.id}`;

  return (
    <Card className="p-4">
      <ReviewHeader title={`${employeeName} · ${review.cycle.name}`} review={review} />
      {review.selfAssessment && (
        <dl className="mt-3 text-sm">
          <AssessmentRow label="Self-assessment" value={review.selfAssessment} />
        </dl>
      )}
      {review.status === "COMPLETED" ? (
        <dl className="mt-3 text-sm">
          <Rating value={review.rating} label="Rating given" />
        </dl>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={assessmentId} className="label">
              Your assessment
            </label>
            <textarea
              id={assessmentId}
              value={managerAssessment}
              onChange={(e) => setManagerAssessment(e.target.value)}
              placeholder="Share feedback on performance, strengths and areas to improve…"
              rows={3}
              className="input"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={ratingId} className="label">
                Rating
              </label>
              <select id={ratingId} value={rating} onChange={(e) => setRating(Number(e.target.value))} className="input w-24">
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r} / 5
                  </option>
                ))}
              </select>
            </div>
            <Button icon={ClipboardCheck} onClick={submit} loading={saving} disabled={!managerAssessment}>
              Complete review
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReviewHeader({ title, review }: { title: string; review: PerformanceReview }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{formatDateRange(review.cycle.startDate, review.cycle.endDate)}</p>
      </div>
      <StatusBadge status={review.status} />
    </div>
  );
}

function AssessmentRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="whitespace-pre-line text-slate-700">{value || "—"}</dd>
    </div>
  );
}

function Rating({ value, label = "Rating" }: { value: number | null; label?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`h-4 w-4 ${value !== null && n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
            aria-hidden="true"
          />
        ))}
        <span className="ml-1 text-sm font-medium text-slate-900">{value ?? "—"}/5</span>
      </dd>
    </div>
  );
}
