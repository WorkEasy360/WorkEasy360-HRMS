"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BookOpen, ChevronRight, FilePlus2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { HrGuideArticle } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate } from "@/components/format";

export default function HrGuidePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("hrguide:manage");
  const { toast } = useFeedback();

  const [articles, setArticles] = useState<HrGuideArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setArticles(await apiFetch<HrGuideArticle[]>("/hr-guide"));
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

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="HR Guide"
        description="Policies, how-tos and answers to common HR questions."
        actions={
          canManage && (
            <Button
              variant={showForm ? "secondary" : "primary"}
              icon={showForm ? undefined : FilePlus2}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Close form" : "New article"}
            </Button>
          )
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <ArticleForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Article published");
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingRows rows={4} />
      ) : articles.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="No articles yet"
            description={
              canManage
                ? "Write your first article to document a policy or answer a frequently asked question."
                : "HR policies and guides will appear here once they are published."
            }
            action={
              canManage &&
              !showForm && (
                <Button icon={FilePlus2} onClick={() => setShowForm(true)}>
                  New article
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/hr-guide/${a.id}`}
              className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{a.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {a.category ? `${a.category} · ` : ""}Updated {formatDate(a.updatedAt)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-blue-500" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/hr-guide", { method: "POST", body: JSON.stringify({ title, body, category: category || undefined }) });
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
          <label htmlFor="article-title" className="label">
            Title
          </label>
          <input id="article-title" required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="article-category" className="label">
            Category <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="article-category"
            placeholder="e.g. Leave, Payroll"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="article-body" className="label">
            Content
          </label>
          <textarea
            id="article-body"
            required
            placeholder="Article content…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Publish article
          </Button>
        </div>
      </form>
    </Card>
  );
}
