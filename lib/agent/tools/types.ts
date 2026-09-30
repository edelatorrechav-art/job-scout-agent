import type { Employer } from "@/lib/employers/types";
import type { LocationPref } from "@/lib/location/types";

export interface ToolContext {
  /** The employer list as of this tool call. */
  employers: Employer[];
  /** The saved location preference, or null for all locations. */
  location: LocationPref | null;
  /** Shows a short progress line in the UI while the tool runs. */
  onStatus: (text: string) => void;
}

export interface ToolOutcome {
  /** Text returned to Claude as the tool_result. */
  content: string;
  isError: boolean;
  /** Set when the tool changed the employer list. */
  employers?: Employer[];
  /** Set when the tool changed the saved location (value null = cleared). */
  location?: { value: LocationPref | null };
}
