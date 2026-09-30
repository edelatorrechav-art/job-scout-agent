import type Anthropic from "@anthropic-ai/sdk";
import type { Employer } from "@/lib/employers/types";

export type MessageParam = Anthropic.Beta.BetaMessageParam;

// Body of POST /api/chat. `messages` is the full conversation so far, ending
// with the new user message. Turns returned by the server must be echoed back
// exactly as received (thinking blocks included). `employers` is the saved
// employer list from localStorage.
export interface ChatRequest {
  messages: MessageParam[];
  employers: Employer[];
}

// The response is newline-delimited JSON: one ChatEvent per line.
export type ChatEvent =
  | { type: "text"; text: string }
  // Progress while a tool runs, e.g. "Looking up job boards…"
  | { type: "status"; text: string }
  // The employer list changed; save it.
  | { type: "employers"; employers: Employer[] }
  // Turns to append to the history after the user's message.
  | { type: "done"; messages: MessageParam[] }
  | { type: "refusal" }
  | { type: "error"; message: string };
