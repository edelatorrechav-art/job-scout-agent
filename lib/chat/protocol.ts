import type Anthropic from "@anthropic-ai/sdk";

export type MessageParam = Anthropic.Beta.BetaMessageParam;

// Body of POST /api/chat. `messages` is the full conversation so far, ending
// with the new user message. Assistant turns must be echoed back exactly as
// the server returned them (thinking blocks included).
export interface ChatRequest {
  messages: MessageParam[];
}

// The response is newline-delimited JSON: one ChatEvent per line.
export type ChatEvent =
  | { type: "text"; text: string }
  // Turns to append to the history after the user's message.
  | { type: "done"; messages: MessageParam[] }
  | { type: "refusal" }
  | { type: "error"; message: string };
