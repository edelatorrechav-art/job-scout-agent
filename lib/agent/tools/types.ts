import type { Employer } from "@/lib/employers/types";

export interface ToolContext {
  /** The employer list as of this tool call. */
  employers: Employer[];
  /** Shows a short progress line in the UI while the tool runs. */
  onStatus: (text: string) => void;
}

export interface ToolOutcome {
  /** Text returned to Claude as the tool_result. */
  content: string;
  isError: boolean;
  /** Set when the tool changed the employer list. */
  employers?: Employer[];
}
