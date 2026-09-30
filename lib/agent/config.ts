import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

// Opus 5.5 always thinks; effort is the only depth control. Its default is
// "medium" — set explicitly so a model change can't silently shift it.
export const EFFORT = "medium" as const;

export const MAX_TOKENS = 64000;

// Server-side refusal fallback: if a safety classifier declines a request,
// the API re-runs it on Anthropic's recommended model for that category.
export const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  "server-side-fallback-2026-07-01",
];
export const FALLBACKS = "default" as const;

// Guardrails on what the browser may send us.
export const MAX_HISTORY_MESSAGES = 100;
export const MAX_USER_MESSAGE_CHARS = 8000;
