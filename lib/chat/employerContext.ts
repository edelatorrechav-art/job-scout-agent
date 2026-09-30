import type { Employer } from "@/lib/employers/types";
import type { MessageParam } from "@/lib/chat/protocol";

// Marks the app-generated system messages that carry the employer list, so the
// server can tell them apart from anything else in the history.
export const EMPLOYER_CONTEXT_PREFIX = "[Tracked employers]";

/** Renders the saved list as a mid-conversation system message. */
export function employerContextMessage(employers: Employer[]): MessageParam {
  const body =
    employers.length === 0
      ? "None yet."
      : employers
          .map((e) => `- ${e.name}: ${e.boardUrl ?? "no job board found"}`)
          .join("\n");
  return {
    role: "system",
    content: `${EMPLOYER_CONTEXT_PREFIX} The user's saved employer list, current as of this message (the user can also edit it outside the chat):\n${body}`,
  };
}

/** The most recent employer-list message in the history, if any. */
export function lastEmployerContext(messages: MessageParam[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system" && typeof m.content === "string") return m.content;
  }
  return null;
}
