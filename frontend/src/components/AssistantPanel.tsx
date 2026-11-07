"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Send, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { AgentAvatar, Button } from "@/ui";

/**
 * The AI assistant: a floating button and a chat window, on every signed-in page.
 *
 * The assistant never writes anything. When it suggests a change, the server
 * sends back a proposal describing the request, and pressing Confirm calls the
 * product's own endpoint — the same one the matching page uses, with the same
 * validation, permissions and audit trail. See docs/04-ai-assistant.md.
 *
 * The conversation lives in this browser tab only (session storage). The server
 * keeps no transcript.
 */

interface Proposal {
  kind: string;
  title: string;
  summary: [string, string][];
  effect: string;
  confirmLabel: string;
  danger: boolean;
  request: { method: "POST" | "PATCH"; path: string; body: Record<string, unknown> };
  done?: { label: string; path: string };
}

interface AssistantAnswer {
  text: string;
  link: { label: string; path: string } | null;
  proposal: Proposal | null;
  actionNote: string | null;
}

type ConfirmState = "idle" | "running" | "done" | "failed";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  link?: { label: string; path: string } | null;
  proposal?: Proposal | null;
  actionNote?: string | null;
  confirm?: ConfirmState;
  confirmNote?: string;
}

const HISTORY_KEY = "we-assistant-history";
const MAX_HISTORY = 12;

function loadHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Message[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: Message[]) {
  try {
    // A proposal is deliberately not stored: when the tab comes back the world
    // may have moved on, and a stale confirm button would be a lie.
    const slim = messages.slice(-MAX_HISTORY).map(({ id, role, text }) => ({ id, role, text }));
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
  } catch {
    // Private windows: the conversation then lasts only as long as the panel.
  }
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Restored during the first render, not in an effect. The panel starts closed,
  // so nothing of this reaches the server-rendered markup.
  const [messages, setMessages] = useState<Message[]>(() => (typeof window === "undefined" ? [] : loadHistory()));
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  // Seeded past any restored message so ids stay unique across a reload.
  const [idSeed] = useState(() => messages.reduce((max, m) => Math.max(max, m.id), 0) + 1);
  const nextId = useRef(idSeed);

  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Ask the server whether the assistant is configured, and for role-appropriate
  // openers. Runs once the panel is first opened, not on every page load.
  useEffect(() => {
    if (!open || enabled !== null) return;
    let cancelled = false;
    apiFetch<{ enabled: boolean; provider: string | null; suggestions: string[] }>("/assistant")
      .then((data) => {
        if (cancelled) return;
        setEnabled(data.enabled);
        setProvider(data.provider);
        setSuggestions(data.suggestions ?? []);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, enabled]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  const close = useCallback(() => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function ask(text: string) {
    const asked = text.trim();
    if (!asked || thinking) return;

    const mine: Message = { id: nextId.current++, role: "user", text: asked };
    const history = messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.text }));
    const next = [...messages, mine];
    setMessages(next);
    saveHistory(next);
    setQuestion("");
    setThinking(true);

    try {
      const answer = await apiFetch<AssistantAnswer>("/assistant", {
        method: "POST",
        body: JSON.stringify({ question: asked, history }),
      });
      const reply: Message = {
        id: nextId.current++,
        role: "assistant",
        text: answer.text,
        link: answer.link,
        proposal: answer.proposal,
        actionNote: answer.actionNote,
        confirm: "idle",
      };
      setMessages((prev) => {
        const updated = [...prev, reply];
        saveHistory(updated);
        return updated;
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", text: message }]);
    } finally {
      setThinking(false);
    }
  }

  async function confirm(message: Message) {
    const proposal = message.proposal;
    if (!proposal || message.confirm === "running" || message.confirm === "done") return;

    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, confirm: "running" } : m)));
    try {
      await apiFetch(proposal.request.path, {
        method: proposal.request.method,
        body: JSON.stringify(proposal.request.body),
      });
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, confirm: "done", confirmNote: "Done." } : m)));
    } catch (err) {
      // The server has the last word: only it can say a change happened.
      const note = err instanceof ApiError ? err.message : "That didn't go through. Please try again.";
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, confirm: "failed", confirmNote: note } : m)));
    }
  }

  function clear() {
    setMessages([]);
    saveHistory([]);
    inputRef.current?.focus();
  }

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="c-fab"
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Ask the assistant"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <X className="size-5" aria-hidden /> : <AgentAvatar className="c-fab-face" />}
      </button>

      {open && (
        <section className="c-chatbox" role="dialog" aria-label="Assistant">
          <header className="c-chatbox-head">
            <span className="flex items-center gap-2">
              <span className="c-agent-chip">
                <AgentAvatar />
              </span>
              <span className="font-semibold text-heading">Assistant</span>
            </span>
            <span className="flex items-center gap-1">
              {messages.length > 0 && (
                <button type="button" onClick={clear} className="c-link text-xs">
                  Clear
                </button>
              )}
              <button type="button" onClick={close} className="c-btn-ghost c-btn-icon c-btn-sm" aria-label="Close the assistant">
                <X className="size-4" aria-hidden />
              </button>
            </span>
          </header>

          <div className="c-chatbox-body">
            {enabled === false && (
              <p className="c-alert" data-tone="warning">
                The assistant isn&apos;t set up for this deployment yet.
              </p>
            )}

            {provider === "stub" && (
              <p className="c-alert" data-tone="warning">
                Running on the local stub, not a model: it reads one record and reports it, and cannot reason or hold a
                conversation. Set <code>AI_PROVIDER=gemini</code> with a key for real answers.
              </p>
            )}

            {enabled !== false && messages.length === 0 && (
              <div className="c-chat-welcome">
                <p className="text-sm text-body">
                  Ask about your leave, attendance, pay or policies. I can also prepare a change for you to confirm.
                </p>
                {suggestions.map((s) => (
                  <button key={s} type="button" className="c-chat-suggestion" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div aria-live="polite">
              {messages.map((m) => (
                <div key={m.id} className="c-chat-turn" data-role={m.role}>
                  <p className="c-chat-bubble" data-role={m.role}>
                    {m.text}
                  </p>

                  {m.link && (
                    <Link href={m.link.path} className="c-btn c-btn-sm mt-2" onClick={close}>
                      Open {m.link.label}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  )}

                  {m.actionNote && !m.proposal && <p className="c-hint">{m.actionNote}</p>}

                  {m.proposal && (
                    <div className="c-chat-card">
                      <p className="c-chat-card-title">{m.proposal.title}</p>
                      <dl className="c-kv c-chat-card-facts">
                        {m.proposal.summary.map(([label, value]) => (
                          <div key={label} className="contents">
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="c-chat-card-effect">{m.proposal.effect}</p>

                      {m.confirm === "done" ? (
                        <p className="c-badge" data-tone="success">
                          {m.confirmNote ?? "Done."}
                        </p>
                      ) : (
                        <div className="c-toolbar">
                          <Button
                            variant={m.proposal.danger ? "danger" : "primary"}
                            size="sm"
                            loading={m.confirm === "running"}
                            onClick={() => confirm(m)}
                          >
                            {m.proposal.confirmLabel}
                          </Button>
                          {m.confirm === "failed" && m.confirmNote && (
                            <span className="text-xs text-danger-text">{m.confirmNote}</span>
                          )}
                        </div>
                      )}

                      {m.confirm === "done" && m.proposal.done && (
                        <Link href={m.proposal.done.path} className="c-link text-xs" onClick={close}>
                          Open {m.proposal.done.label}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {thinking && (
                <p className="c-chat-bubble flex items-center gap-2" data-role="assistant">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Thinking…
                </p>
              )}
            </div>
            <div ref={endRef} />
          </div>

          <form
            className="c-chatbox-foot"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor="assistant-question" className="sr-only">
              Your question
            </label>
            <textarea
              id="assistant-question"
              ref={inputRef}
              className="c-textarea c-chat-input"
              rows={1}
              maxLength={2000}
              value={question}
              placeholder="Ask about leave, pay, policies…"
              disabled={enabled === false}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
            />
            <Button type="submit" size="sm" disabled={!question.trim() || thinking || enabled === false} aria-label="Send">
              {thinking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            </Button>
          </form>
          <p className="c-chatbox-note">
            <Check className="size-3" aria-hidden /> Nothing changes until you confirm it.
          </p>
        </section>
      )}
    </>
  );
}
