import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext, ToolOutcome } from "@/lib/agent/tools/types";
import { findOpenRolesTool, runFindOpenRoles } from "@/lib/agent/tools/findOpenRoles";
import {
  runSetLocationPreference,
  setLocationPreferenceTool,
} from "@/lib/agent/tools/setLocationPreference";
import {
  runUpdateEmployerList,
  updateEmployerListTool,
} from "@/lib/agent/tools/updateEmployerList";

// Order is part of the cached prompt prefix; keep it fixed.
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  updateEmployerListTool,
  findOpenRolesTool,
  setLocationPreferenceTool,
];

const RUNNERS: Record<string, (input: unknown, ctx: ToolContext) => Promise<ToolOutcome>> = {
  [updateEmployerListTool.name]: runUpdateEmployerList,
  [findOpenRolesTool.name]: runFindOpenRoles,
  [setLocationPreferenceTool.name]: runSetLocationPreference,
};

export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const run = RUNNERS[name];
  if (!run) return { isError: true, content: `Unknown tool: ${name}` };
  try {
    return await run(input, ctx);
  } catch (error) {
    console.error(`tool ${name} failed`, error);
    return { isError: true, content: `The ${name} tool failed unexpectedly.` };
  }
}
