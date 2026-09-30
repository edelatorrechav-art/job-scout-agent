import type Anthropic from "@anthropic-ai/sdk";
import type { Employer } from "@/lib/employers/types";
import type { LocationPref } from "@/lib/location/types";

export type MessageParam = Anthropic.Beta.BetaMessageParam;

// Body of POST /api/chat. `messages` is the full conversation so far, ending
// with the new user message. Turns returned by the server must be echoed back
// exactly as received (thinking blocks included). `employers` and `location`
// are the saved settings from localStorage.
export interface ChatRequest {
  messages: MessageParam[];
  employers: Employer[];
  location: LocationPref | null;
}

// The response is newline-delimited JSON: one ChatEvent per line.
export type ChatEvent =
  | { type: "text"; text: string }
  // Progress while a tool runs, e.g. "Looking up job boards…"
  | { type: "status"; text: string }
  // The employer list changed; save it.
  | { type: "employers"; employers: Employer[] }
  // The saved location preference changed (null = cleared); save it.
  | { type: "location"; location: LocationPref | null }
  // Turns to append to the history after the user's message.
  | { type: "done"; messages: MessageParam[] }
  | { type: "refusal" }
  | { type: "error"; message: string };
