import type { ChatEvent, MessageParam } from "@/lib/chat/protocol";

export type ChatResult =
  | { type: "done"; messages: MessageParam[] }
  | { type: "refusal" }
  | { type: "error"; message: string };

/**
 * Sends the conversation to /api/chat, calling onText for each streamed piece
 * of the reply. Resolves with how the turn ended. Throws only on abort.
 */
export async function streamChat(
  messages: MessageParam[],
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<ChatResult> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { type: "error", message: "Couldn't reach the server." };
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    return {
      type: "error",
      message: body?.error ?? `Request failed (${response.status}).`,
    };
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ChatEvent;
      if (event.type === "text") onText(event.text);
      else return event;
    }
  }
  return { type: "error", message: "The response ended unexpectedly." };
}
