import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext, ToolOutcome } from "@/lib/agent/tools/types";
import { describeLocation, parseLocation } from "@/lib/location/types";

export const setLocationPreferenceTool: Anthropic.Beta.BetaTool = {
  name: "set_location_preference",
  description:
    "Saves (or clears) the user's standing location preference, which every later job search uses until it's changed. " +
    "Use it when the user states an ongoing preference, e.g. \"I only want jobs in Oklahoma\", \"from now on, remote only\", \"stop filtering by location\". " +
    "Don't use it for a location mentioned in a single search request (\"financial analyst jobs in Oklahoma City\"); pass that to find_open_roles instead.",
  input_schema: {
    type: "object",
    properties: {
      location: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "City, state, or region as the user said it (e.g. \"Oklahoma City, OK\", \"Oklahoma\"), or \"remote\" for remote-only. Null to clear the preference.",
      },
      includeRemote: {
        type: "boolean",
        description: "True only if the user wants remote roles included alongside the location.",
      },
    },
    required: ["location", "includeRemote"],
    additionalProperties: false,
  },
  strict: true,
};

export async function runSetLocationPreference(
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const i = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (i.location !== null && typeof i.location !== "string") {
    return { isError: true, content: "location must be a string or null." };
  }
  const pref = parseLocation(i.location as string | null, i.includeRemote === true);
  return {
    isError: false,
    location: { value: pref },
    content: JSON.stringify({
      saved: describeLocation(pref),
      previous: describeLocation(ctx.location),
    }),
  };
}
