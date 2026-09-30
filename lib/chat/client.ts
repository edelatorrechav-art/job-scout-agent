import type { ChatEvent, MessageParam } from "@/lib/chat/protocol";
import type { Employer } from "@/lib/employers/types";
import type { LocationPref } from "@/lib/location/types";

export interface ChatHandlers {
  onText: (text: string) => void;
  onStatus: (text: string) => void;
  onEmployers: (employers: Employer[]) => void;
  onLocation: (location: LocationPref | null) => void;
}

export type ChatResult =
  | { type: "done"; messages: MessageParam[] }
  | { type: "refusal" }
  | { type: "error"; message: string };

/**
 * Sends the conversation and saved settings to /api/chat, calling the
 * handlers as events stream in. Resolves with how the turn ended. Throws only
 * on abort.
 */
export async function streamChat(
  messages: MessageParam[],
  employers: Employer[],
  location: LocationPref | null,
  handlers: ChatHandlers,
  signal: AbortSignal,
): Promise<ChatResult> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, employers, location }),
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
      if (event.type === "text") handlers.onText(event.text);
      else if (event.type === "status") handlers.onStatus(event.text);
      else if (event.type === "employers") handlers.onEmployers(event.employers);
      else if (event.type === "location") handlers.onLocation(event.location);
      else return event;
    }
  }
  return { type: "error", message: "The response ended unexpectedly." };
}
