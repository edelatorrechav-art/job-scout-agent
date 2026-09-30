import type Anthropic from "@anthropic-ai/sdk";
import type { ToolOutcome, ToolContext } from "@/lib/agent/tools/types";
import {
  ATS_DOMAINS,
  NON_BOARD_DOMAINS,
  pickBoard,
} from "@/lib/employers/boardResolver";
import {
  companyKey,
  MAX_COMPANY_NAME_CHARS,
  MAX_EMPLOYERS,
  type Employer,
} from "@/lib/employers/types";
import { searchUrls, tavilyConfigured } from "@/lib/services/tavily";

const MIN_EMPLOYERS = 2;
const MAX_COMPANIES_PER_CALL = 15;
const MODES = ["add", "replace", "remove"] as const;
type Mode = (typeof MODES)[number];

export const updateEmployerListTool: Anthropic.Beta.BetaTool = {
  name: "update_employer_list",
  description:
    "Changes the user's saved list of employers to track, and looks up each new company's job board (careers page) on the web. " +
    "Use mode \"add\" whenever the user names companies to track or follow — this is the default. " +
    "Use \"replace\" only when the user clearly asks to start over or replace the whole list. " +
    "Use \"remove\" when the user asks to stop tracking or delete specific companies. " +
    "The saved list must contain at least 2 companies after an add or replace. " +
    "Returns the updated list, including any companies whose job board could not be found. " +
    "Don't call this just to read the list; the current list is provided in the conversation.",
  input_schema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: [...MODES],
        description: "add (default), replace (only on explicit request), or remove.",
      },
      companies: {
        type: "array",
        items: { type: "string" },
        description: "Company names exactly as the user gave them, e.g. [\"Stripe\", \"Airbnb\"].",
      },
    },
    required: ["mode", "companies"],
    additionalProperties: false,
  },
  strict: true,
};

export async function runUpdateEmployerList(
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const parsed = parseInput(input);
  if (typeof parsed === "string") return { isError: true, content: parsed };
  const { mode, companies } = parsed;
  const current = ctx.employers;

  if (mode === "remove") {
    const keys = new Set(companies.map(companyKey));
    const kept = current.filter((e) => !keys.has(companyKey(e.name)));
    const removed = current.filter((e) => keys.has(companyKey(e.name))).map((e) => e.name);
    const notOnList = companies.filter(
      (c) => !current.some((e) => companyKey(e.name) === companyKey(c)),
    );
    return result({ mode, removed, notOnList }, kept);
  }

  // add / replace
  const base = mode === "replace" ? [] : current;
  const byKey = new Map(current.map((e) => [companyKey(e.name), e]));
  const alreadyTracked: string[] = [];
  const toResolve: string[] = [];
  const reused: Employer[] = [];
  for (const name of companies) {
    const existing = byKey.get(companyKey(name));
    if (existing?.boardUrl) {
      // Already resolved; keep it rather than paying for another lookup.
      if (mode === "add") alreadyTracked.push(existing.name);
      else reused.push(existing);
    } else {
      toResolve.push(name); // new, or a previous lookup found nothing: retry
    }
  }

  const unchanged = base.filter(
    (e) => !toResolve.some((n) => companyKey(n) === companyKey(e.name)),
  );
  const finalCount = unchanged.length + reused.length + toResolve.length;
  if (finalCount < MIN_EMPLOYERS) {
    return {
      isError: true,
      content: `The list needs at least ${MIN_EMPLOYERS} companies, but this ${mode} would leave ${finalCount}. Nothing was saved. Ask the user for more companies.`,
    };
  }
  if (finalCount > MAX_EMPLOYERS) {
    return {
      isError: true,
      content: `The list is limited to ${MAX_EMPLOYERS} companies; this ${mode} would make ${finalCount}. Nothing was saved. Ask the user which companies to drop.`,
    };
  }
  if (toResolve.length > 0 && !tavilyConfigured()) {
    return {
      isError: true,
      content: "Job board lookup isn't configured on the server (TAVILY_API_KEY is missing). Nothing was saved. Tell the user the app's setup is incomplete.",
    };
  }

  if (toResolve.length > 0) {
    ctx.onStatus(`Looking up job boards for ${toResolve.join(", ")}…`);
  }
  const resolved = await Promise.all(toResolve.map(resolveEmployer));

  const employers = [...unchanged, ...reused, ...resolved.map((r) => r.employer)];
  return result(
    {
      mode,
      added: resolved
        .filter((r) => r.employer.boardUrl)
        .map(({ employer }) => ({ name: employer.name, boardUrl: employer.boardUrl, atsType: employer.atsType })),
      savedWithoutBoard: resolved
        .filter((r) => !r.employer.boardUrl)
        .map((r) => ({ name: r.employer.name, reason: r.failed ? "lookup failed; try again later" : "no job board found" })),
      ...(alreadyTracked.length ? { alreadyTracked } : {}),
    },
    employers,
  );
}

function result(summary: Record<string, unknown>, employers: Employer[]): ToolOutcome {
  return {
    isError: false,
    employers,
    content: JSON.stringify({
      ...summary,
      employers: employers.map((e) => ({ name: e.name, boardUrl: e.boardUrl })),
    }),
  };
}

async function resolveEmployer(name: string): Promise<{ employer: Employer; failed: boolean }> {
  let failed = false;
  let match = null;
  try {
    match = pickBoard(
      name,
      await searchUrls(`${name} careers open positions`, { excludeDomains: NON_BOARD_DOMAINS }),
    );
    if (!match) {
      match = pickBoard(name, await searchUrls(`${name} jobs`, { includeDomains: ATS_DOMAINS }));
    }
  } catch (error) {
    console.error(`job board lookup failed for ${name}`, error);
    failed = true;
  }
  return {
    failed,
    employer: {
      name,
      boardUrl: match?.boardUrl ?? null,
      atsType: match?.atsType ?? null,
      resolvedAt: new Date().toISOString(),
    },
  };
}

function parseInput(input: unknown): { mode: Mode; companies: string[] } | string {
  if (typeof input !== "object" || input === null) return "Invalid input.";
  const { mode, companies } = input as { mode?: unknown; companies?: unknown };
  if (!MODES.includes(mode as Mode)) return `mode must be one of: ${MODES.join(", ")}.`;
  if (!Array.isArray(companies) || !companies.every((c) => typeof c === "string")) {
    return "companies must be an array of company names.";
  }
  // Trim, collapse spaces, and drop blanks and duplicates.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of companies as string[]) {
    const name = raw.replace(/\s+/g, " ").trim();
    const key = companyKey(name);
    if (!key || seen.has(key)) continue;
    if (name.length > MAX_COMPANY_NAME_CHARS) return `Company names are limited to ${MAX_COMPANY_NAME_CHARS} characters.`;
    seen.add(key);
    names.push(name);
  }
  if (names.length === 0) return "No company names were given.";
  if (names.length > MAX_COMPANIES_PER_CALL) {
    return `At most ${MAX_COMPANIES_PER_CALL} companies per call.`;
  }
  return { mode: mode as Mode, companies: names };
}
