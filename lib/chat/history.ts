import type Anthropic from "@anthropic-ai/sdk";
import { MAX_HISTORY_MESSAGES, MAX_USER_MESSAGE_CHARS } from "@/lib/agent/config";
import { SETTINGS_CONTEXT_PREFIXES } from "@/lib/chat/settingsContext";
import type { MessageParam } from "@/lib/chat/protocol";

type ContentBlock = Anthropic.Beta.BetaContentBlock;

/**
 * Checks the conversation the browser sent. Returns an error message, or null
 * if it is usable. User turns are plain strings; assistant turns are content
 * block arrays echoed back from earlier responses.
 */
export function validateHistory(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "messages must be a non-empty array";
  }
  if (messages.length > MAX_HISTORY_MESSAGES) {
    return "This conversation is too long. Start a new chat to continue.";
  }
  for (const [i, m] of messages.entries()) {
    if (typeof m !== "object" || m === null) return `messages[${i}] is invalid`;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role === "user") {
      if (Array.isArray(content)) {
        // Tool results from an earlier turn.
        if (!content.every((b) => b?.type === "tool_result")) {
          return `messages[${i}] may only contain tool results`;
        }
      } else if (typeof content !== "string" || content.trim() === "") {
        return `messages[${i}] must have text content`;
      } else if (content.length > MAX_USER_MESSAGE_CHARS) {
        return `Messages are limited to ${MAX_USER_MESSAGE_CHARS} characters.`;
      }
    } else if (role === "assistant") {
      if (!Array.isArray(content)) return `messages[${i}] content must be an array`;
    } else if (role === "system") {
      // Only the app's own saved-settings messages.
      if (typeof content !== "string" || !SETTINGS_CONTEXT_PREFIXES.some((p) => content.startsWith(p))) {
        return `messages[${i}] is not a recognized system message`;
      }
    } else {
      return `messages[${i}] has an unknown role`;
    }
  }
  if ((messages[0] as MessageParam).role !== "user") return "the first message must be from the user";
  const last = messages.at(-1) as MessageParam;
  if (last.role !== "user" || typeof last.content !== "string") {
    return "the last message must be the user's new message";
  }
  return null;
}

/**
 * Returns the assistant content to store in history. Normally that is the
 * whole response, unchanged. If a refusal fallback happened mid-response,
 * blocks before the last `fallback` marker came from the declining model;
 * only their text may be sent back.
 */
export function echoableContent(content: ContentBlock[]): ContentBlock[] {
  const boundary = content.findLastIndex((b) => b.type === "fallback");
  if (boundary === -1) return content;
  return [
    ...content.slice(0, boundary).filter((b) => b.type === "text"),
    ...content.slice(boundary + 1),
  ];
}
