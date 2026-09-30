"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon, LedgerIcon, MenuIcon, PlusIcon, SendIcon, StopIcon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { Sidebar } from "@/components/Sidebar";
import { streamChat } from "@/lib/chat/client";
import type { MessageParam } from "@/lib/chat/protocol";
import { getEmployers, saveEmployers, useEmployers } from "@/lib/employers/store";
import { getLocation, saveLocation, useLocation } from "@/lib/location/store";

interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "done" | "stopped" | "failed";
  note?: string;
  /** Tool progress shown while streaming, e.g. "Auditing 3 job boards…" */
  progress?: string;
}

const EXAMPLES = [
  { label: "Track employers", prompt: "Track Paycom and Devon Energy" },
  { label: "Search roles", prompt: "Financial analyst jobs in Oklahoma City" },
  { label: "Set a location", prompt: "I only want jobs in Oklahoma" },
  { label: "Interview prep", prompt: "How do I answer 'tell me about yourself'?" },
];

export function ChatWindow() {
  // `history` is what the API sees; `turns` is what the page shows. They
  // differ when a turn fails: it stays visible but isn't sent as context.
  const [history, setHistory] = useState<MessageParam[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const employers = useEmployers();
  const location = useLocation();
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSidebarOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  function updateTurn(id: number, patch: (t: Turn) => Partial<Turn>) {
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)));
  }

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;

    const messages: MessageParam[] = [...history, { role: "user", content: text }];
    const userId = nextId.current++;
    const replyId = nextId.current++;
    setTurns((ts) => [
      ...ts,
      { id: userId, role: "user", text, status: "done" },
      { id: replyId, role: "assistant", text: "", status: "streaming" },
    ]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamChat(
        messages,
        getEmployers(),
        getLocation(),
        {
          onText: (chunk) =>
            updateTurn(replyId, (t) => ({ text: t.text + chunk, progress: undefined })),
          onStatus: (progress) => updateTurn(replyId, () => ({ progress })),
          // Saved right away, even if the reply later fails: the change happened.
          onEmployers: saveEmployers,
          onLocation: saveLocation,
        },
        controller.signal,
      );
      if (result.type === "done") {
        setHistory([...messages, ...result.messages]);
        updateTurn(replyId, () => ({ status: "done", progress: undefined }));
      } else {
        const note =
          result.type === "refusal"
            ? "Claude declined to answer this. Try rephrasing your question."
            : result.message;
        // A declined or failed reply isn't kept, so drop any partial text and
        // give the user their message back to retry.
        updateTurn(replyId, () => ({ text: "", status: "failed", note, progress: undefined }));
        setInput((current) => current || text);
      }
    } catch {
      updateTurn(replyId, () => ({ status: "stopped", note: "Stopped.", progress: undefined }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setHistory([]);
    setTurns([]);
    setInput("");
  }

  const sidebar = (
    <Sidebar
      employers={employers}
      location={location}
      disabled={busy}
      onRemove={(name) => saveEmployers(employers.filter((e) => e.name !== name))}
      onClearLocation={() => saveLocation(null)}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-page">
      <header className="z-20 bg-navy text-white shadow-md">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Show saved employers and location"
            className="relative -ml-1 rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
            {employers.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {employers.length}
              </span>
            )}
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 ring-1 ring-brand/40">
            <LedgerIcon className="h-5 w-5 text-brand" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight tracking-tight">Job Ledger</h1>
            <p className="hidden text-xs text-white/60 sm:block">Your job search, reconciled.</p>
          </div>
          <button
            type="button"
            onClick={newChat}
            disabled={turns.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm font-medium text-white/90 transition hover:border-white/40 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <PlusIcon className="h-4 w-4" />
            <span className="hidden sm:inline">New chat</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white md:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Saved settings">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]"
            />
            <aside className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between bg-navy px-5 py-3.5 text-white">
                <span className="font-semibold">Your ledger</span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{sidebar}</div>
            </aside>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-6 md:py-8">
              {turns.length === 0 ? (
                <AgentMessage>
                  <p className="text-base font-semibold text-navy">Good day. I&apos;m Job Ledger.</p>
                  <p className="mt-2">
                    Think of me as your job search accountant. Give me the companies you want on the
                    books and the roles you&apos;re after, and I&apos;ll audit their job boards and
                    reconcile every posting, with the pay front and center. I&apos;m also happy to
                    help with resumes, interviews, and offers.
                  </p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Try one of these
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex.prompt}
                        type="button"
                        onClick={() => send(ex.prompt)}
                        className="group rounded-xl border border-slate-200 bg-page px-3.5 py-2.5 text-left transition hover:border-brand hover:bg-brand-50"
                      >
                        <span className="block text-[11px] font-semibold uppercase tracking-wider text-brand-600">
                          {ex.label}
                        </span>
                        <span className="mt-0.5 block text-sm font-medium text-navy">{ex.prompt}</span>
                      </button>
                    ))}
                  </div>
                </AgentMessage>
              ) : (
                turns.map((turn) =>
                  turn.role === "user" ? (
                    <div key={turn.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-navy px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
                        {turn.text}
                      </div>
                    </div>
                  ) : (
                    <AgentMessage key={turn.id}>
                      {turn.text && <Markdown text={turn.text} />}
                      {turn.status === "streaming" && (turn.progress || !turn.text) && (
                        <StatusLine text={turn.progress ?? "Crunching the numbers…"} spaced={Boolean(turn.text)} />
                      )}
                      {turn.note && (
                        <p
                          className={
                            (turn.text ? "mt-2 " : "") +
                            (turn.status === "failed" ? "text-sm font-medium text-red-600" : "text-sm text-slate-400")
                          }
                        >
                          {turn.note}
                        </p>
                      )}
                    </AgentMessage>
                  ),
                )
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="border-t border-slate-200 bg-white/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:px-6"
          >
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-slate-300 bg-white p-1.5 pl-4 shadow-sm transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask about roles, employers, or your job search…"
                aria-label="Message"
                rows={1}
                className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Stop"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-white transition hover:bg-navy-700"
                >
                  <StopIcon className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Send"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  <SendIcon className="h-5 w-5" />
                </button>
              )}
            </div>
            <p className="mx-auto mt-1.5 hidden max-w-3xl px-1 text-[11px] text-slate-400 md:block">
              Enter to send · Shift+Enter for a new line
            </p>
          </form>
        </main>
      </div>
    </div>
  );
}

/** An agent message: avatar on the left, white card on the right. */
function AgentMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy shadow-sm ring-2 ring-white">
        <LedgerIcon className="h-4 w-4 text-brand" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3.5 text-[15px] leading-relaxed text-slate-700 shadow-sm md:px-5">
        {children}
      </div>
    </div>
  );
}

/** Animated progress line shown while the agent works. */
function StatusLine({ text, spaced }: { text: string; spaced: boolean }) {
  return (
    <p
      role="status"
      className={
        "flex items-center gap-2.5 text-sm font-medium text-brand-600" + (spaced ? " mt-3 border-t border-slate-100 pt-3" : "")
      }
    >
      <span className="flex gap-1" aria-hidden="true">
        <span className="ledger-dot h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="ledger-dot h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="ledger-dot h-1.5 w-1.5 rounded-full bg-brand" />
      </span>
      {text}
    </p>
  );
}
