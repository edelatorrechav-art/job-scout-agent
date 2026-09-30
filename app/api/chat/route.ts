import Anthropic from "@anthropic-ai/sdk";
import {
  BETAS,
  EFFORT,
  FALLBACKS,
  MAX_TOKENS,
  MAX_TOOL_ROUNDS,
  MODEL,
} from "@/lib/agent/config";
import { SYSTEM_PROMPT } from "@/lib/agent/systemPrompt";
import { runTool, TOOLS } from "@/lib/agent/tools";
import { lastSettingsContext, settingsContextMessage } from "@/lib/chat/settingsContext";
import { echoableContent, validateHistory } from "@/lib/chat/history";
import type { ChatEvent, ChatRequest, MessageParam } from "@/lib/chat/protocol";
import { isEmployerList, type Employer } from "@/lib/employers/types";
import { isLocationPref, type LocationPref } from "@/lib/location/types";

export const runtime = "nodejs";
// A job search reads many pages (the tool itself stops at ~75s) plus two
// Claude turns. 300s is the Vercel Hobby maximum with Fluid compute.
export const maxDuration = 300;

const client = new Anthropic();

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const problem = validateHistory(body?.messages);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (!isEmployerList(body.employers ?? [])) {
    return Response.json({ error: "The saved employer list is invalid." }, { status: 400 });
  }
  const location = body.location ?? null;
  if (location !== null && !isLocationPref(location)) {
    return Response.json({ error: "The saved location is invalid." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        await runAgent(body.messages, body.employers ?? [], location, send, request.signal);
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("chat request failed", error);
          send({ type: "error", message: describeError(error) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Runs Claude with tools until it gives a final answer. Everything appended
 * to the conversation goes back to the browser in the `done` event.
 */
async function runAgent(
  history: MessageParam[],
  initialEmployers: Employer[],
  initialLocation: LocationPref | null,
  send: (event: ChatEvent) => void,
  signal: AbortSignal,
) {
  let employers = initialEmployers;
  let location = initialLocation;
  const added: MessageParam[] = [];

  // Tell Claude the saved settings, but only when they changed since the last
  // time they were stated (the user can edit them outside the chat).
  const context = settingsContextMessage(employers, location);
  if (context.content !== lastSettingsContext(history)) added.push(context);

  let sentText = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const claude = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: BETAS,
        fallbacks: FALLBACKS,
        output_config: { effort: EFFORT },
        // Caches the conversation prefix so each follow-up turn only pays
        // full price for what's new.
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: [...history, ...added],
      },
      { signal },
    );

    let startedThisRound = false;
    for await (const event of claude) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        // Separate text from different rounds (before and after a tool call).
        const prefix = sentText && !startedThisRound ? "\n\n" : "";
        startedThisRound = sentText = true;
        send({ type: "text", text: prefix + event.delta.text });
      }
    }

    const message = await claude.finalMessage();
    if (message.stop_reason === "refusal") {
      send({ type: "refusal" });
      return;
    }

    const content = echoableContent(message.content);
    added.push({ role: "assistant", content });

    const toolUses = content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break;
    if (message.stop_reason === "max_tokens") {
      throw new Error("tool call was cut off at max_tokens");
    }

    // Run sequentially: each call sees the settings as the previous one left them.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const outcome = await runTool(use.name, use.input, {
        employers,
        location,
        onStatus: (text) => send({ type: "status", text }),
      });
      if (outcome.employers) {
        employers = outcome.employers;
        send({ type: "employers", employers });
      }
      if (outcome.location) {
        location = outcome.location.value;
        send({ type: "location", location });
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    added.push({ role: "user", content: results });
  }

  send({ type: "done", messages: added });
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The server's Anthropic API key was rejected.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Too many requests right now. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return "The request was rejected. Try starting a new chat.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "Claude is temporarily unavailable. Try again shortly.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Claude API. Try again shortly.";
  }
  return "Something went wrong. Try again.";
}
