import type Anthropic from "@anthropic-ai/sdk";
import type { ToolOutcome, ToolContext } from "@/lib/agent/tools/types";
import {
  ATS_DOMAINS,
  isWeakBoard,
  NON_BOARD_DOMAINS,
  pickBoard,
  pickBoardFromLinks,
  type ScoredBoard,
} from "@/lib/employers/boardResolver";
import { renderWait } from "@/lib/jobs/boardScope";
import { firecrawlConfigured, pageLinks } from "@/lib/services/firecrawl";
import {
  companyKey,
  MAX_COMPANY_NAME_CHARS,
  MAX_EMPLOYERS,
  sameCompany,
  searchName,
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
    "Adding a company that's already tracked re-checks its job board; use that when the user says a company's jobs can't be found or asks to re-check it. " +
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
    const matches = (e: Employer) => companies.some((c) => sameCompany(e.name, c));
    const kept = current.filter((e) => !matches(e));
    const removed = current.filter(matches).map((e) => e.name);
    const notOnList = companies.filter((c) => !current.some((e) => sameCompany(e.name, c)));
    return result({ mode, removed, notOnList }, kept);
  }

  // add / replace. Naming a company that's already tracked re-checks its job
  // board (the user may be asking because searches came up empty).
  // `lookup` is the name as given now (often more specific, e.g. the full
  // official name); `name` keeps the saved display name.
  const toResolve: { name: string; lookup: string; existing?: Employer }[] = [];
  const reused: Employer[] = [];
  for (const name of companies) {
    const existing = current.find((e) => sameCompany(e.name, name));
    if (existing && (toResolve.some((t) => t.existing === existing) || reused.includes(existing))) continue;
    if (mode === "replace" && existing?.boardUrl) reused.push(existing);
    else toResolve.push({ name: existing?.name ?? name, lookup: name, existing });
  }

  const base = mode === "replace" ? [] : current;
  const unchanged = base.filter((e) => !toResolve.some((t) => t.existing === e));
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
    ctx.onStatus(`Opening the books on ${toResolve.map((t) => t.name).join(", ")}…`);
  }
  const resolved = await Promise.all(
    toResolve.map(async (t) => {
      const r = await resolveEmployer(t.name, t.lookup, t.existing?.boardUrl ?? null);
      // A failed re-check keeps the board we already had.
      const keptOld = !r.employer.boardUrl && Boolean(t.existing?.boardUrl);
      return { ...t, ...r, employer: keptOld ? t.existing! : r.employer, keptOld };
    }),
  );

  const replacement = new Map(resolved.flatMap((r) => (r.existing ? [[r.existing, r.employer] as const] : [])));
  const employers =
    mode === "replace"
      ? [...reused, ...resolved.map((r) => r.employer)]
      : [
          ...current.map((e) => replacement.get(e) ?? e),
          ...resolved.filter((r) => !r.existing).map((r) => r.employer),
        ];
  const board = (e: Employer) => ({ name: e.name, boardUrl: e.boardUrl, atsType: e.atsType });
  const rechecked = resolved.filter((r) => r.existing && mode === "add");
  return result(
    {
      mode,
      added: resolved.filter((r) => !rechecked.includes(r) && r.employer.boardUrl).map((r) => board(r.employer)),
      ...(rechecked.length
        ? {
            rechecked: rechecked.map((r) => ({
              ...board(r.employer),
              previousBoardUrl: r.existing!.boardUrl,
              ...(r.keptOld ? { note: "re-check found nothing better; kept the previous board" } : {}),
            })),
          }
        : {}),
      savedWithoutBoard: resolved
        .filter((r) => !r.employer.boardUrl)
        .map((r) => ({ name: r.employer.name, reason: r.failed ? "lookup failed; try again later" : "no job board found" })),
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

/**
 * Finds a company's job board: web search for its careers pages, then a
 * search limited to hosted job-board platforms, then — if the best hit is
 * still the company's own careers page — that page's links, since a
 * marketing careers page usually links to the real job search. On a re-check,
 * the previously saved board is a candidate too.
 */
async function resolveEmployer(
  name: string,
  lookup: string,
  previousBoardUrl: string | null,
): Promise<{ employer: Employer; failed: boolean }> {
  const query = searchName(lookup);
  let failed = false;
  let best: ScoredBoard | null = null;
  const consider = (b: ScoredBoard | null) => {
    if (b && (!best || b.score > best.score)) best = b;
  };
  // Match against both names: "Love's" and "Love's Travel Stops & Country Stores".
  const pick = (urls: string[]) => {
    consider(pickBoard(lookup, urls));
    if (lookup !== name) consider(pickBoard(name, urls));
  };
  if (previousBoardUrl) pick([previousBoardUrl]);
  try {
    pick(await searchUrls(`${query} careers job search`, { excludeDomains: NON_BOARD_DOMAINS }));
    if (!best || isWeakBoard(best)) {
      pick(await searchUrls(`${query} jobs`, { includeDomains: ATS_DOMAINS }));
    }
  } catch (error) {
    console.error(`job board lookup failed for ${name}`, error);
    failed = true;
  }
  const found = best as ScoredBoard | null;
  if (found && isWeakBoard(found) && firecrawlConfigured()) {
    try {
      const links = await pageLinks(found.boardUrl, renderWait("company-site"));
      consider(pickBoardFromLinks(lookup, found.boardUrl, links));
    } catch (error) {
      console.error(`could not read links on ${found.boardUrl}`, error);
    }
  }
  const match = best as ScoredBoard | null;
  return {
    failed: failed && !match,
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
