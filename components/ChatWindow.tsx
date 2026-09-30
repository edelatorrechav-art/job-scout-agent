"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { streamChat } from "@/lib/chat/client";
import type { MessageParam } from "@/lib/chat/protocol";

interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "done" | "stopped" | "failed";
  note?: string;
}

const EXAMPLES = [
  "How should I tailor my resume for a product manager role?",
  "What questions should I ask at the end of an interview?",
  "What does a solutions engineer do?",
];

export function ChatWindow() {
  // `history` is what the API sees; `turns` is what the page shows. They
  // differ when a turn fails: it stays visible but isn't sent as context.
  const [history, setHistory] = useState<MessageParam[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

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
        (chunk) => updateTurn(replyId, (t) => ({ text: t.text + chunk })),
        controller.signal,
      );
      if (result.type === "done") {
        setHistory([...messages, ...result.messages]);
        updateTurn(replyId, () => ({ status: "done" }));
      } else {
        const note =
          result.type === "refusal"
            ? "Claude declined to answer this. Try rephrasing your question."
            : result.message;
        // A declined or failed reply isn't kept, so drop any partial text and
        // give the user their message back to retry.
        updateTurn(replyId, () => ({ text: "", status: "failed", note }));
        setInput((current) => current || text);
      }
    } catch {
      updateTurn(replyId, () => ({ status: "stopped", note: "Stopped." }));
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

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Job Scout</h1>
        <button
          onClick={newChat}
          disabled={turns.length === 0}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          New chat
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6">
        {turns.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-2xl font-semibold">Find your next role</p>
            <p className="mt-2 text-zinc-500">
              Job search across your chosen companies is coming soon. For now, ask
              me anything about your job hunt.
            </p>
            <div className="mt-8 flex flex-col items-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => send(example)}
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {turns.map((turn) => (
              <li
                key={turn.id}
                className={turn.role === "user" ? "flex justify-end" : "flex"}
              >
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2 text-white"
                      : "max-w-full leading-relaxed"
                  }
                >
                  {turn.role === "user" ? (
                    turn.text
                  ) : turn.text ? (
                    <Markdown text={turn.text} />
                  ) : turn.status === "streaming" ? (
                    <span className="animate-pulse text-zinc-400">Thinking…</span>
                  ) : null}
                  {turn.note && (
                    <p
                      className={
                        turn.status === "failed"
                          ? "text-sm text-red-600 dark:text-red-400"
                          : "mt-1 text-sm text-zinc-400"
                      }
                    >
                      {turn.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 focus-within:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about your job search…"
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none field-sizing-content"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl bg-zinc-200 px-4 py-2 text-sm font-medium hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
