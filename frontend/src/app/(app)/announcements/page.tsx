"use client";

import { FormEvent, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Announcement } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate } from "@/components/format";

export default function AnnouncementsPage() {
  const { hasPermission } = useAuth();
  const { toast } = useFeedback();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<Announcement[]>("/announcements");
      setAnnouncements(data);
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

  const canManage = hasPermission("announcement:manage");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Announcements"
        description="Company news and updates shared with everyone in your organization."
        actions={
          canManage && (
            <Button
              variant={showForm ? "secondary" : "primary"}
              icon={showForm ? undefined : Megaphone}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Close form" : "New announcement"}
            </Button>
          )
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <AnnouncementForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Announcement published");
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingRows rows={3} />
      ) : announcements.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="No announcements yet"
            description={
              canManage
                ? "Share news, policy updates or celebrations with your whole organization."
                : "Company news and updates from HR will appear here."
            }
            action={
              canManage &&
              !showForm && (
                <Button icon={Megaphone} onClick={() => setShowForm(true)}>
                  New announcement
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="font-semibold text-slate-900">{a.title}</h2>
                <time dateTime={a.publishedAt} className="text-xs text-slate-400">
                  {formatDate(a.publishedAt)}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{a.body}</p>
              <p className="mt-3 text-xs text-slate-400">
                Posted by {a.author.firstName} {a.author.lastName}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
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
        <div className="sm:col-span-2">
          <label htmlFor="announcement-title" className="label">
            Title
          </label>
          <input
            id="announcement-title"
            required
            placeholder="e.g. Office closed on Friday"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="announcement-body" className="label">
            Message
          </label>
          <textarea
            id="announcement-body"
            required
            placeholder="Announcement text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Publish
          </Button>
        </div>
      </form>
    </Card>
  );
}
