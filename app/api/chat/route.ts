import Anthropic from "@anthropic-ai/sdk";
import {
  BETAS,
  EFFORT,
  FALLBACKS,
  MAX_TOKENS,
  MODEL,
} from "@/lib/agent/config";
import { SYSTEM_PROMPT } from "@/lib/agent/systemPrompt";
import { echoableContent, validateHistory } from "@/lib/chat/history";
import type { ChatEvent, ChatRequest } from "@/lib/chat/protocol";

export const runtime = "nodejs";
// Room for long answers now and tool calls later. Vercel caps this per plan.
export const maxDuration = 60;

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
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
            messages: body.messages,
          },
          { signal: request.signal },
        );

        for await (const event of claude) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send({ type: "text", text: event.delta.text });
          }
        }

        const message = await claude.finalMessage();
        if (message.stop_reason === "refusal") {
          send({ type: "refusal" });
        } else {
          send({
            type: "done",
            messages: [
              { role: "assistant", content: echoableContent(message.content) },
            ],
          });
        }
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
