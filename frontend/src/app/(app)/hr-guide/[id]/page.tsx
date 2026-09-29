"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { HrGuideArticle } from "@/lib/types";
import { Card, EmptyState, Skeleton } from "@/components/ui";
import { formatDate } from "@/components/format";

export default function HrGuideArticlePage(props: PageProps<"/hr-guide/[id]">) {
  const { id } = use(props.params);
  const [article, setArticle] = useState<HrGuideArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HrGuideArticle>(`/hr-guide/${id}`)
      .then(setArticle)
      .catch(() => setError("Article not found."))
      .finally(() => setLoading(false));
  }, [id]);

  const backLink = (
    <Link href="/hr-guide" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
      <ArrowLeft className="h-4 w-4" />
      Back to HR Guide
    </Link>
  );

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="max-w-2xl space-y-4">
        {backLink}
        <Card>
          <EmptyState
            icon={FileQuestion}
            title={error ?? "Article not found."}
            description="It may have been removed, or the link is incorrect. Browse the HR Guide to find what you need."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {backLink}
      <div>
        {article.category && (
          <span className="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {article.category}
          </span>
        )}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{article.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          By {article.author.firstName} {article.author.lastName} · Updated {formatDate(article.updatedAt)}
        </p>
      </div>
      <Card className="whitespace-pre-wrap break-words p-5 text-sm leading-relaxed text-slate-700 sm:p-6">{article.body}</Card>
    </div>
  );
}
