import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext, ToolOutcome } from "@/lib/agent/tools/types";
import { isOnBoard, searchDomain } from "@/lib/jobs/boardScope";
import { extractPosting, firecrawlConfigured } from "@/lib/services/firecrawl";
import { searchUrls, tavilyConfigured } from "@/lib/services/tavily";
import { beforeDeadline, DeadlineError, mapWithLimit } from "@/lib/util/async";
import { companyKey, type Employer } from "@/lib/employers/types";
import { matchLocation } from "@/lib/location/match";
import { describeLocation, parseLocation, type LocationPref } from "@/lib/location/types";

export const DEFAULT_PER_COMPANY = 5;
const MAX_PER_COMPANY = 10;
// Keeps a big list × "10 each" from running for minutes or burning credits.
const MAX_TOTAL_POSTINGS = 40;
const SEARCH_CONCURRENCY = 5;
const SCRAPE_CONCURRENCY = 6;
// Wall-clock budget for the whole tool call; postings not read by then are
// reported as timed out rather than holding up the reply.
const TIME_BUDGET_MS = 75_000;
const MAX_JOB_TYPE_CHARS = 100;
// With a location filter some postings get dropped, so read extra per company.
const MAX_READS_PER_COMPANY_FILTERED = 15;

export const findOpenRolesTool: Anthropic.Beta.BetaTool = {
  name: "find_open_roles",
  description:
    "Searches the job boards of the user's saved employers for open roles of a given type, reads each posting, and returns title, company, location, pay, and link. " +
    "Use it whenever the user asks about open jobs, openings, or roles at their tracked companies. " +
    "Only companies on the saved list with a known job board can be searched. " +
    `Returns up to ${DEFAULT_PER_COMPANY} postings per company unless the user asks for a different number (max ${MAX_PER_COMPANY}). ` +
    "Search results can include roles that don't match the job type; drop those when presenting. " +
    "Location: pass `location` when the user names a place for this search (\"financial analyst jobs in Oklahoma City\"). " +
    "Leave it null to use the user's saved location preference (shown in the \"[Saved settings]\" message), or to search all locations if none is saved. " +
    "Pass \"anywhere\" only if the user asks to ignore their saved preference for this search. " +
    "Postings whose stated location doesn't match are filtered out; remote roles are kept only when includeRemote is true (or location is \"remote\").",
  input_schema: {
    type: "object",
    properties: {
      jobType: {
        type: "string",
        description: "The kind of role, in the user's words, e.g. \"staff accountant\", \"backend engineer\", \"product designer\".",
      },
      location: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "City, state, or region the user asked for in this request (e.g. \"Oklahoma City, OK\", \"Oklahoma\"), \"remote\" for remote-only, \"anywhere\" to ignore the saved preference, or null to use the saved preference.",
      },
      includeRemote: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
        description: "True only if the user asked for remote roles too. Null to follow the saved preference (or false when a location is given here).",
      },
      companies: {
        anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
        description: "Only search these saved companies; null to search all of them.",
      },
      maxPerCompany: {
        anyOf: [{ type: "integer" }, { type: "null" }],
        description: `How many postings per company. Null for the default (${DEFAULT_PER_COMPANY}); set it only when the user asks for more or fewer (max ${MAX_PER_COMPANY}).`,
      },
    },
    required: ["jobType", "location", "includeRemote", "companies", "maxPerCompany"],
    additionalProperties: false,
  },
  strict: true,
};

interface Input {
  jobType: string;
  location: string | null;
  includeRemote: boolean | null;
  companies: string[] | null;
  maxPerCompany: number | null;
}

interface Posting {
  title: string;
  location: string;
  pay: string;
  url: string;
}

interface CompanyReport {
  company: string;
  postings: Posting[];
  note?: string;
  droppedByLocation?: { elsewhere?: number; remote?: number; locationNotListed?: number };
}

export async function runFindOpenRoles(input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = parseInput(input);
  if (typeof parsed === "string") return { isError: true, content: parsed };
  if (!tavilyConfigured() || !firecrawlConfigured()) {
    return {
      isError: true,
      content: "Job search isn't configured on the server (TAVILY_API_KEY or FIRECRAWL_API_KEY is missing). Tell the user the app's setup is incomplete.",
    };
  }

  const { jobType } = parsed;
  const { filter, source } = resolveLocation(parsed, ctx.location);
  const requested = parsed.maxPerCompany ?? DEFAULT_PER_COMPANY;
  const perCompany = Math.min(Math.max(Math.round(requested), 1), MAX_PER_COMPANY);

  // Which saved employers to search.
  const skipped: { company: string; reason: string }[] = [];
  let targets: Employer[] = ctx.employers;
  if (parsed.companies) {
    const keys = new Set(parsed.companies.map(companyKey));
    targets = ctx.employers.filter((e) => keys.has(companyKey(e.name)));
    for (const name of parsed.companies) {
      if (!ctx.employers.some((e) => companyKey(e.name) === companyKey(name))) {
        skipped.push({ company: name, reason: "not on the saved list" });
      }
    }
  }
  for (const e of targets.filter((e) => !e.boardUrl)) {
    skipped.push({ company: e.name, reason: "no job board on file" });
  }
  const searchable = targets.filter((e): e is Employer & { boardUrl: string } => Boolean(e.boardUrl));
  if (searchable.length === 0) {
    return {
      isError: true,
      content: JSON.stringify({
        error: "No saved companies with a job board to search. Ask the user to add companies first.",
        skipped,
      }),
    };
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const where = !filter ? "" : filter.place ? ` ${filter.place}${filter.remote ? " or remote" : ""}` : " remote";
  const readsPerCompany = filter ? Math.min(perCompany * 2, MAX_READS_PER_COMPANY_FILTERED) : perCompany;
  ctx.onStatus(
    `Searching ${searchable.length} job board${searchable.length === 1 ? "" : "s"} for ${jobType} (${describeLocation(filter)})…`,
  );

  // 1. Find candidate posting URLs on each board.
  const candidates = await mapWithLimit(searchable, SEARCH_CONCURRENCY, async (employer) => {
    try {
      const hosted = employer.atsType !== "company-site";
      const urls = await beforeDeadline(
        searchUrls(`${employer.name} ${jobType}${where} job`, {
          includeDomains: [searchDomain(employer.boardUrl)],
          maxResults: Math.min(readsPerCompany * 2, 20),
        }),
        deadline,
      );
      const onBoard = [...new Set(urls.filter((u) => isOnBoard(u, employer.boardUrl, hosted)))];
      return { employer, urls: onBoard.slice(0, readsPerCompany), failed: false };
    } catch (error) {
      if (!(error instanceof DeadlineError)) console.error(`search failed for ${employer.name}`, error);
      return { employer, urls: [] as string[], failed: true };
    }
  });

  // Spread the overall cap across companies in order.
  let budget = MAX_TOTAL_POSTINGS;
  const jobs = candidates.flatMap((c) => {
    const take = c.urls.slice(0, Math.max(budget, 0));
    budget -= take.length;
    return take.map((url) => ({ company: c.employer.name, url }));
  });
  const capped = candidates.reduce((n, c) => n + c.urls.length, 0) > jobs.length;

  // 2. Read each posting.
  let done = 0;
  if (jobs.length > 0) ctx.onStatus(`Reading ${jobs.length} posting${jobs.length === 1 ? "" : "s"}…`);
  const extracted = await mapWithLimit(jobs, SCRAPE_CONCURRENCY, async (job) => {
    let outcome: Posting | "not-a-posting" | "failed" | "timed-out";
    try {
      const p = await beforeDeadline(extractPosting(job.url), deadline);
      outcome =
        p.isJobPosting && p.title
          ? {
              title: p.title,
              location: p.location ?? "Not listed",
              pay: p.pay ?? "Not listed",
              // Always the URL we read, never a link taken from the page.
              url: job.url,
            }
          : "not-a-posting";
    } catch (error) {
      if (error instanceof DeadlineError) outcome = "timed-out";
      else {
        console.error(`could not read ${job.url}`, error);
        outcome = "failed";
      }
    }
    done++;
    ctx.onStatus(`Reading postings (${done}/${jobs.length})…`);
    return { ...job, outcome };
  });

  // 3. Assemble per-company results.
  const companies: CompanyReport[] = candidates.map(({ employer, failed }) => {
    const mine = extracted.filter((e) => e.company === employer.name);
    const read = mine.flatMap((e) => (typeof e.outcome === "object" ? [e.outcome] : []));
    const unread = mine.filter((e) => e.outcome === "failed" || e.outcome === "timed-out").length;

    // Location filter, then the per-company limit.
    const dropped = { elsewhere: 0, remote: 0, locationNotListed: 0 };
    const kept = filter
      ? read.filter((p) => {
          const verdict = matchLocation(p.location, filter);
          if (verdict === "elsewhere") dropped.elsewhere++;
          if (verdict === "remote-excluded") dropped.remote++;
          if (verdict === "unknown") dropped.locationNotListed++;
          return verdict === "match";
        })
      : read;
    const postings = kept.slice(0, perCompany);

    const notes: string[] = [];
    if (failed) notes.push("the job board search failed or timed out");
    else if (mine.length === 0) notes.push("no matching postings found on the job board");
    else if (filter && postings.length === 0 && read.length > 0) notes.push("no postings in the requested location");
    if (unread > 0) notes.push(`${unread} posting(s) couldn't be read`);
    const droppedByLocation = Object.fromEntries(Object.entries(dropped).filter(([, n]) => n > 0));
    return {
      company: employer.name,
      postings,
      ...(notes.length ? { note: notes.join("; ") } : {}),
      ...(Object.keys(droppedByLocation).length ? { droppedByLocation } : {}),
    };
  });

  return {
    isError: false,
    content: JSON.stringify({
      jobType,
      filteredTo: describeLocation(filter),
      locationSource: source,
      perCompanyLimit: perCompany,
      ...(requested > MAX_PER_COMPANY ? { note: `Capped at ${MAX_PER_COMPANY} per company.` } : {}),
      ...(capped ? { totalCap: `Stopped at ${MAX_TOTAL_POSTINGS} postings in total.` } : {}),
      companies,
      ...(skipped.length ? { skipped } : {}),
    }),
  };
}

function parseInput(input: unknown): Input | string {
  if (typeof input !== "object" || input === null) return "Invalid input.";
  const i = input as Record<string, unknown>;
  const jobType = typeof i.jobType === "string" ? i.jobType.replace(/\s+/g, " ").trim() : "";
  if (!jobType) return "jobType is required. Ask the user what kind of role they want.";
  if (jobType.length > MAX_JOB_TYPE_CHARS) return `jobType is limited to ${MAX_JOB_TYPE_CHARS} characters.`;
  const location =
    typeof i.location === "string" && i.location.trim() ? i.location.trim().slice(0, 100) : null;
  const includeRemote = typeof i.includeRemote === "boolean" ? i.includeRemote : null;
  let companies: string[] | null = null;
  if (Array.isArray(i.companies)) {
    companies = i.companies.filter((c): c is string => typeof c === "string" && c.trim() !== "");
    if (companies.length === 0) companies = null;
  }
  const maxPerCompany =
    typeof i.maxPerCompany === "number" && Number.isFinite(i.maxPerCompany) ? i.maxPerCompany : null;
  return { jobType, location, includeRemote, companies, maxPerCompany };
}

/**
 * The location filter for this search: one given in the request wins, then
 * the saved preference, then none (all locations).
 */
function resolveLocation(
  input: Input,
  saved: LocationPref | null,
): { filter: LocationPref | null; source: string } {
  if (input.location) {
    return { filter: parseLocation(input.location, input.includeRemote ?? false), source: "this request" };
  }
  if (saved) {
    const remote = input.includeRemote ?? saved.remote;
    const filter = saved.place || remote ? { place: saved.place, remote } : null;
    return { filter, source: "saved preference" };
  }
  if (input.includeRemote) return { filter: { place: null, remote: true }, source: "this request" };
  return { filter: null, source: "none set" };
}
