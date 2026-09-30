import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext, ToolOutcome } from "@/lib/agent/tools/types";
import { atsAccountMatches, namesMatch, NON_BOARD_DOMAINS, registrableDomain } from "@/lib/employers/boardResolver";
import { isOnBoard, renderWait, searchDomain, type BoardRef } from "@/lib/jobs/boardScope";
import { extractPosting, firecrawlConfigured, listPostings } from "@/lib/services/firecrawl";
import { searchUrls, tavilyConfigured } from "@/lib/services/tavily";
import { beforeDeadline, createLimiter, DeadlineError, mapWithLimit } from "@/lib/util/async";
import { nameVariants, sameCompany, searchName, type Employer } from "@/lib/employers/types";
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
// Render waits (ms) for JavaScript-built pages: a board's listing page, and
// the retry for a posting page that came back empty.
const BOARD_RENDER_WAIT_MS = 5000;
const LONG_RENDER_WAIT_MS = 7000;

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

type ReadOutcome = Posting | "not-a-posting" | "failed" | "timed-out";

interface CompanyReport {
  company: string;
  /**
   * ok: postings found. no-matching-roles: the board was read, nothing fit.
   * board-unreadable: we couldn't see the company's openings at all.
   */
  status: "ok" | "no-matching-roles" | "board-unreadable";
  reason?: string;
  boardUrl: string;
  searched: string[];
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
    const wanted = parsed.companies;
    targets = ctx.employers.filter((e) => wanted.some((n) => sameCompany(e.name, n)));
    for (const name of wanted) {
      if (!ctx.employers.some((e) => sameCompany(e.name, name))) {
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

  // Shared across companies: page reads run a few at a time, and the total
  // number of postings read is capped.
  const scrape = createLimiter(SCRAPE_CONCURRENCY);
  let readBudget = MAX_TOTAL_POSTINGS;
  let readCount = 0;
  let capped = false;

  const readPosting = async (url: string, wait: number): Promise<ReadOutcome> => {
    try {
      let p = await beforeDeadline(scrape(() => extractPosting(url, wait)), deadline);
      // Nothing extracted: the page may not have finished rendering. Try once
      // more with a longer wait if there's time.
      if (!p.isJobPosting && !p.title && deadline - Date.now() > 20_000) {
        p = await beforeDeadline(scrape(() => extractPosting(url, LONG_RENDER_WAIT_MS)), deadline);
      }
      if (!p.isJobPosting || !p.title) return "not-a-posting";
      // Always the URL we read, never a link taken from the page.
      return { title: p.title, location: p.location ?? "Not listed", pay: p.pay ?? "Not listed", url };
    } catch (error) {
      if (error instanceof DeadlineError) return "timed-out";
      console.error(`could not read ${url}`, error);
      return "failed";
    } finally {
      readCount++;
      ctx.onStatus(`Reading postings (${readCount} read)…`);
    }
  };

  const companies: CompanyReport[] = await mapWithLimit(searchable, SEARCH_CONCURRENCY, async (employer) => {
    const ref = { name: employer.name, boardUrl: employer.boardUrl, atsType: employer.atsType };
    const wait = renderWait(employer.atsType);
    const query = `${searchName(employer.name)} ${jobType}${where} job`;
    const tried: string[] = [];
    const seen = new Set<string>();
    const outcomes: ReadOutcome[] = [];
    let boardListing: "listed" | "empty" | "failed" | "not-tried" = "not-tried";
    let searchFailed = false;

    const readAll = async (urls: string[]) => {
      const fresh = urls.filter((u) => !seen.has(u)).slice(0, readsPerCompany);
      fresh.forEach((u) => seen.add(u));
      const allowed = fresh.slice(0, Math.max(readBudget, 0));
      readBudget -= allowed.length;
      if (allowed.length < fresh.length) capped = true;
      outcomes.push(...(await Promise.all(allowed.map((u) => readPosting(u, wait)))));
    };
    const gotPostings = () => outcomes.some((o) => typeof o === "object");

    // 1. Search engine results on the board's own domain.
    try {
      const urls = await beforeDeadline(
        searchUrls(query, { includeDomains: [searchDomain(employer.boardUrl)], maxResults: Math.min(readsPerCompany * 2, 20) }),
        deadline,
      );
      tried.push("job board search");
      await readAll(urls.filter((u) => isOnBoard(u, ref)));
    } catch (error) {
      if (!(error instanceof DeadlineError)) console.error(`search failed for ${employer.name}`, error);
      searchFailed = true;
    }

    // 2. The board page itself, after its JavaScript renders.
    if (!gotPostings() && Date.now() < deadline) {
      ctx.onStatus(`Opening the job board for ${employer.name}…`);
      try {
        const listed = await beforeDeadline(scrape(() => listPostings(employer.boardUrl, Math.max(wait, BOARD_RENDER_WAIT_MS))), deadline);
        tried.push("job board page");
        boardListing = listed.length > 0 ? "listed" : "empty";
        const relevant = listed.filter(
          (p) =>
            isOnBoard(p.url, ref) &&
            titleMatches(p.title, jobType) &&
            // Skip listings whose shown location already rules them out.
            !(filter && p.location && ["elsewhere", "remote-excluded"].includes(matchLocation(p.location, filter))),
        );
        await readAll(relevant.map((p) => p.url));
      } catch (error) {
        if (!(error instanceof DeadlineError)) console.error(`could not read board ${employer.boardUrl}`, error);
        boardListing = "failed";
      }
    }

    // 3. A web-wide search for individual postings from this company.
    if (!gotPostings() && Date.now() < deadline) {
      try {
        const urls = await beforeDeadline(
          searchUrls(query, { excludeDomains: NON_BOARD_DOMAINS, maxResults: 10 }),
          deadline,
        );
        tried.push("web search");
        await readAll(urls.filter((u) => isCompanyPosting(u, ref)));
      } catch (error) {
        if (!(error instanceof DeadlineError)) console.error(`web search failed for ${employer.name}`, error);
      }
    }

    // Location filter, then the per-company limit.
    const read = outcomes.flatMap((o) => (typeof o === "object" ? [o] : []));
    const unread = outcomes.filter((o) => o === "failed" || o === "timed-out").length;
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

    // Could we actually see this company's openings? Only then is "no
    // matching roles" a fair statement.
    let status: CompanyReport["status"];
    let reason: string | undefined;
    if (postings.length > 0) status = "ok";
    else if (read.length > 0 || boardListing === "listed") status = "no-matching-roles";
    else {
      status = "board-unreadable";
      reason =
        outcomes.length > 0
          ? "found posting pages but none could be read"
          : boardListing === "empty"
            ? "the job board page showed no listings, even after waiting for it to load"
            : boardListing === "failed"
              ? "the job board page couldn't be loaded"
              : searchFailed
                ? "the job board search failed"
                : "no postings could be found or read";
    }

    const notes: string[] = [];
    if (status === "no-matching-roles" && filter && read.length > 0) notes.push("no postings in the requested location");
    if (unread > 0) notes.push(`${unread} posting page(s) couldn't be read`);
    const droppedByLocation = Object.fromEntries(Object.entries(dropped).filter(([, n]) => n > 0));
    return {
      company: employer.name,
      status,
      boardUrl: employer.boardUrl,
      postings,
      searched: tried,
      ...(reason ? { reason } : {}),
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

/**
 * True if a web search result is plausibly this company's own posting: on its
 * board, on a hosted job board under its name, or on a domain named after it.
 */
function isCompanyPosting(url: string, ref: BoardRef): boolean {
  if (isOnBoard(url, ref)) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (atsAccountMatches(u, ref.name)) return true;
  const domainName = registrableDomain(u.hostname).split(".")[0];
  return namesMatch(nameVariants(ref.name), domainName) && /job|career|position|opening|requisition/i.test(u.href);
}

const TITLE_STOPWORDS = new Set(["job", "jobs", "role", "roles", "position", "positions", "opening", "openings", "the", "and", "for", "with"]);

/**
 * Loose check that a listed title fits the requested job type: any
 * significant word of the job type appears in the title (by its first five
 * letters, so "analyst" matches "Analytics"… and "driver" matches "Drivers").
 */
function titleMatches(title: string, jobType: string): boolean {
  const words = jobType.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !TITLE_STOPWORDS.has(w));
  if (words.length === 0) return true;
  const t = title.toLowerCase();
  return words.some((w) => t.includes(w.slice(0, 5)));
}
