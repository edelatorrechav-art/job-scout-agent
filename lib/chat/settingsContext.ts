import type { Employer } from "@/lib/employers/types";
import { describeLocation, type LocationPref } from "@/lib/location/types";
import type { MessageParam } from "@/lib/chat/protocol";

// Marks the app-generated system messages that carry the user's saved
// settings, so the server can tell them apart from anything else in the
// history. The older prefix is still accepted for conversations begun before
// the location preference existed.
export const SETTINGS_CONTEXT_PREFIX = "[Saved settings]";
export const SETTINGS_CONTEXT_PREFIXES = [SETTINGS_CONTEXT_PREFIX, "[Tracked employers]"];

/** Renders the saved employer list and location as a mid-conversation system message. */
export function settingsContextMessage(
  employers: Employer[],
  location: LocationPref | null,
): MessageParam {
  const list =
    employers.length === 0
      ? "None yet."
      : employers.map((e) => `- ${e.name}: ${e.boardUrl ?? "no job board found"}`).join("\n");
  return {
    role: "system",
    content:
      `${SETTINGS_CONTEXT_PREFIX} The user's saved settings, current as of this message (the user can also edit them outside the chat).\n` +
      `Location preference: ${location ? describeLocation(location) : "none (all locations)"}\n` +
      `Tracked employers:\n${list}`,
  };
}

/** The most recent settings message in the history, if any. */
export function lastSettingsContext(messages: MessageParam[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system" && typeof m.content === "string") return m.content;
  }
  return null;
}
