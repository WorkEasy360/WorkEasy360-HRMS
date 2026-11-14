"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Download, FileText, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { EmployeeDocument } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage, useFeedback } from "./feedback";
import { formatCalendarDate } from "./format";

/**
 * Documents inside an employee profile (Employees 2.2.2). There is no company
 * document module: files live with the person they belong to.
 *
 * The server checks permission on the list *and* on every download, so this
 * component never decides who may see a file — it only decides what to show.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx";

export function DocumentsPanel({ employeeId, title = "Documents" }: { employeeId: string; title?: string }) {
  const { hasPermission } = useAuth();
  const { toast, confirm } = useFeedback();
  const canVerify = hasPermission("document:manage");
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDocuments(await apiFetch<EmployeeDocument[]>(`/documents?employeeId=${employeeId}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  /** Downloads go through the API so the bearer token travels with them. */
  async function download(doc: EmployeeDocument) {
    setBusyId(doc.id);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"}/documents/${doc.id}/content`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken") ?? ""}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't download that file.");
    } finally {
      setBusyId(null);
    }
  }

  async function verify(doc: EmployeeDocument) {
    setBusyId(doc.id);
    try {
      await apiFetch(`/documents/${doc.id}/verify`, { method: "POST" });
      toast.success("Document verified");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(doc: EmployeeDocument) {
    const ok = await confirm({
      title: "Delete this document?",
      description: `${doc.title} (${doc.fileName}). This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(doc.id);
    try {
      await apiFetch(`/documents/${doc.id}`, { method: "DELETE" });
      toast.success("Document deleted");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="space-y-4">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        <UploadForm employeeId={employeeId} onUploaded={load} />

        {loading ? (
          <LoadingRows rows={2} />
        ) : documents.length === 0 ? (
          <EmptyState icon={FileText} title="No documents yet" description="Upload a PDF, image or Word file up to 5 MB." />
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="size-icon shrink-0 text-secondary" strokeWidth={2} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-heading">
                    {d.title}
                    {d.verifiedAt && (
                      <span className="ml-2 c-badge" data-tone="success">
                        Verified
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-secondary">
                    {d.fileName} · {Math.round(d.sizeBytes / 1024)} KB · {formatCalendarDate(d.createdAt)}
                    {d.category ? ` · ${d.category}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" icon={Download} loading={busyId === d.id} onClick={() => download(d)}>
                    Download
                  </Button>
                  {canVerify && !d.verifiedAt && (
                    <Button variant="ghost" size="sm" icon={BadgeCheck} loading={busyId === d.id} onClick={() => verify(d)}>
                      Verify
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                    loading={busyId === d.id}
                    onClick={() => remove(d)}
                  >
                    <span className="sr-only">Delete {d.title}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function UploadForm({ employeeId, onUploaded }: { employeeId: string; onUploaded: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files must be 5 MB or smaller.");
      return;
    }
    setSubmitting(true);
    try {
      const buffer = await file.arrayBuffer();
      // Base64 in chunks: spreading a large array into String.fromCharCode
      // overflows the call stack.
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      await apiFetch("/documents", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          title: title || file.name,
          ...(category ? { category } : {}),
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: btoa(binary),
        }),
      });
      setTitle("");
      setCategory("");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 rounded-md bg-muted p-3 sm:grid-cols-4">
      <div className="sm:col-span-2">
        <label htmlFor="doc-file" className="c-label">
          File
        </label>
        <input
          id="doc-file"
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="c-input"
        />
      </div>
      <div>
        <label htmlFor="doc-title" className="c-label">
          Title
        </label>
        <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PAN card" className="c-input" />
      </div>
      <div>
        <label htmlFor="doc-category" className="c-label">
          Category <span className="font-normal text-secondary">(optional)</span>
        </label>
        <input id="doc-category" value={category} onChange={(e) => setCategory(e.target.value)} className="c-input" />
      </div>
      {error && <p className="text-sm text-danger-text sm:col-span-4">{error}</p>}
      <div className="sm:col-span-4">
        <Button type="submit" size="sm" icon={Upload} loading={submitting}>
          Upload
        </Button>
      </div>
    </form>
  );
}
