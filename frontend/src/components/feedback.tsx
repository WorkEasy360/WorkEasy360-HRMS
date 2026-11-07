"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, type Tone } from "@/ui";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; message: string };

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
};

interface FeedbackContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TOAST_ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const TOAST_TONES: Record<ToastKind, Tone> = { success: "success", error: "danger", info: "info" };

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  // Stable identity so consumers can list `toast` in effect dependencies safely.
  const value = useMemo<FeedbackContextValue>(
    () => ({
      toast: {
        success: (m: string) => push("success", m),
        error: (m: string) => push("error", m),
        info: (m: string) => push("info", m),
      },
      confirm,
    }),
    [push, confirm],
  );

  function close(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
        {toasts.map((t) => {
          const Icon = TOAST_ICONS[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              data-tone={TOAST_TONES[t.kind]}
              className="c-alert animate-toast-in pointer-events-auto shadow-lg"
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="flex-1">{t.message}</p>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      {pending && <ConfirmDialog options={pending} onClose={close} />}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="c-dialog z-[70]" onClick={() => onClose(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="c-dialog-panel animate-toast-in max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          {options.destructive && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-text">
              <AlertTriangle className="size-5" aria-hidden />
            </div>
          )}
          <div>
            <h2 id="confirm-title" className="c-dialog-title">
              {options.title}
            </h2>
            {options.description && <p className="mt-1 text-sm text-secondary">{options.description}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button variant={options.destructive ? "danger" : "primary"} onClick={() => onClose(true)}>
            {options.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider");
  return ctx;
}

/** Normalise any thrown value into a message suitable for a toast. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}
