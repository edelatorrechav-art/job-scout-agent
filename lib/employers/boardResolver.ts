import { nameVariants, type AtsType } from "@/lib/employers/types";

export interface BoardMatch {
  boardUrl: string;
  atsType: AtsType;
}

// Aggregators and other sites that list a company's jobs but aren't its board.
export const NON_BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "monster.com",
  "careerbuilder.com",
  "dice.com",
  "builtin.com",
  "wellfound.com",
  "angel.co",
  "levels.fyi",
  "comparably.com",
  "themuse.com",
  "welcometothejungle.com",
  "otta.com",
  "workatastartup.com",
  "ycombinator.com",
  "lensa.com",
  "jooble.org",
  "talent.com",
  "snagajob.com",
  "salary.com",
  "crunchbase.com",
  "wikipedia.org",
  "reddit.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
];

// Domains of hosted job boards, used to steer the fallback search.
export const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "workable.com",
  "jobvite.com",
  "icims.com",
  "bamboohr.com",
  "recruitee.com",
  "ultipro.com",
  "taleo.net",
  "successfactors.com",
  "dayforcehcm.com",
  "oraclecloud.com",
  "workforcenow.adp.com",
];

/** How strongly a URL looks like the company's job board. */
const SCORE = {
  hostedBoard: 3, // Greenhouse, Workday, … account matching the company
  jobSearchPage: 2, // jobs.acme.com, acme.com/careers/search, acme.com/jobs
  careersPage: 1, // acme.com/careers — often a marketing page linking elsewhere
};

export interface ScoredBoard extends BoardMatch {
  score: number;
}

/**
 * Picks the company's job board from search result URLs (in rank order).
 * Prefers a hosted board whose account name matches the company, then a job
 * search page on the company's own domain, then a general careers page.
 * Returns null if nothing plausible is found.
 */
export function pickBoard(companyName: string, urls: string[]): ScoredBoard | null {
  const variants = nameVariants(companyName);
  if (variants.length === 0) return null;
  let best: ScoredBoard | null = null;
  for (const url of parseUrls(urls)) {
    const ats = matchAts(url);
    const hit: ScoredBoard | null =
      ats && ats.account && namesMatch(variants, ats.account)
        ? { ...ats.board, score: SCORE.hostedBoard }
        : ats
          ? null
          : matchCompanySite(url, variants);
    if (hit && (!best || hit.score > best.score)) best = hit;
  }
  return best;
}

/**
 * Picks a better board from the links on a company's careers page: any hosted
 * job board it links to (trusted because the company's own page links it,
 * even if the account is an opaque code), or else a job search page on the
 * company's domain.
 */
export function pickBoardFromLinks(
  companyName: string,
  careersPageUrl: string,
  links: string[],
): ScoredBoard | null {
  const variants = nameVariants(companyName);
  const pageDomain = registrableDomain(new URL(careersPageUrl).hostname);
  let best: ScoredBoard | null = null;
  for (const url of parseUrls(links)) {
    const ats = matchAts(url);
    let hit: ScoredBoard | null = null;
    if (ats) hit = { ...ats.board, score: SCORE.hostedBoard };
    else if (registrableDomain(url.hostname) === pageDomain) {
      const site = matchCompanySite(url, variants, true);
      if (site && site.score === SCORE.jobSearchPage) hit = site;
    }
    if (hit && (!best || hit.score > best.score)) best = hit;
  }
  return best;
}

/** True if `url` is on a hosted job board under an account matching the company. */
export function atsAccountMatches(url: URL, companyName: string): boolean {
  const ats = matchAts(url);
  return Boolean(ats?.account && namesMatch(nameVariants(companyName), ats.account));
}

/** True if the board is a general careers page worth checking for a better link. */
export function isWeakBoard(board: ScoredBoard): boolean {
  return board.score < SCORE.hostedBoard;
}

function parseUrls(urls: string[]): URL[] {
  return urls.flatMap((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" ? [url] : [];
    } catch {
      return [];
    }
  });
}

interface AtsHit {
  /** The company's account on the platform; may be an opaque code. */
  account: string | null;
  board: BoardMatch;
}

function matchAts(url: URL): AtsHit | null {
  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split("/").filter(Boolean);
  const firstLabel = host.split(".")[0];
  const hit = (account: string | undefined | null, boardUrl: string, atsType: AtsType): AtsHit | null =>
    account ? { account, board: { boardUrl, atsType } } : null;

  if (/^(job-)?boards(\.eu)?\.greenhouse\.io$/.test(host)) {
    // Embedded boards look like /embed/job_board?for=<account>
    const account = segs[0] === "embed" ? url.searchParams.get("for") : segs[0];
    return hit(account, `https://${host}/${account}`, "greenhouse");
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) {
    return hit(segs[0], `https://${host}/${segs[0]}`, "lever");
  }
  if (host === "jobs.ashbyhq.com") {
    return hit(segs[0], `https://${host}/${segs[0]}`, "ashby");
  }
  if (host.endsWith(".myworkdayjobs.com")) {
    // /<site> or /<locale>/<site>, e.g. /en-US/External
    const site = /^[a-z]{2}-[a-z]{2}$/i.test(segs[0] ?? "") ? segs[1] : segs[0];
    return site ? hit(firstLabel, `https://${host}/${site}`, "workday") : null;
  }
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    return hit(segs[0], `https://${host}/${segs[0]}`, "smartrecruiters");
  }
  if (host === "apply.workable.com") {
    return hit(segs[0], `https://${host}/${segs[0]}`, "workable");
  }
  if (host === "jobs.jobvite.com") {
    return hit(segs[0], `https://${host}/${segs[0]}`, "jobvite");
  }
  if (host.endsWith(".icims.com")) {
    return hit(firstLabel.replace(/^careers-/, ""), `https://${host}/jobs/search`, "icims");
  }
  if (host.endsWith(".bamboohr.com")) {
    return hit(firstLabel, `https://${host}/careers`, "bamboohr");
  }
  if (host.endsWith(".recruitee.com")) {
    return hit(firstLabel, `https://${host}`, "recruitee");
  }
  if (/^recruiting\d*\.ultipro\.com$/.test(host)) {
    // /<TENANT>/JobBoard/<board-id>/…
    if (segs[1]?.toLowerCase() !== "jobboard" || !segs[2]) return null;
    return hit(segs[0], `https://${host}/${segs[0]}/JobBoard/${segs[2]}`, "ultipro");
  }
  if (host.endsWith(".taleo.net")) {
    // /careersection/<section>/jobsearch.ftl
    const board = segs[0] === "careersection" && segs[1]
      ? `https://${host}/careersection/${segs[1]}/jobsearch.ftl`
      : `https://${host}`;
    return hit(firstLabel, board, "taleo");
  }
  if (host.endsWith(".successfactors.com") || host.endsWith(".successfactors.eu")) {
    const company = url.searchParams.get("company");
    return company ? hit(company, `https://${host}/career?company=${encodeURIComponent(company)}`, "successfactors") : null;
  }
  if (host === "jobs.dayforcehcm.com") {
    // /<locale>/<tenant>/…
    const [locale, tenant] = segs;
    return tenant ? hit(tenant, `https://${host}/${locale}/${tenant}`, "dayforce") : null;
  }
  if (host.endsWith(".oraclecloud.com") && segs[0]?.toLowerCase() === "hcmui") {
    // /hcmUI/CandidateExperience/<locale>/sites/<site>
    const i = segs.findIndex((s) => s === "sites");
    if (i === -1 || !segs[i + 1]) return null;
    return hit(firstLabel, `https://${host}/${segs.slice(0, i + 2).join("/")}`, "oracle");
  }
  if (host === "workforcenow.adp.com") {
    const cid = url.searchParams.get("cid");
    return cid
      ? hit(cid, `https://${host}/mascsr/default/mdf/recruitment/recruitment.html?cid=${encodeURIComponent(cid)}`, "adp")
      : null;
  }
  return null;
}

const CAREERS_SUBDOMAINS = new Set(["careers", "jobs", "job", "work", "join", "apply", "hiring"]);
const CAREERS_SEGMENT = /^(careers?|jobs?|join(-us)?|work-with-us|opportunities|employment)$/i;
const SEARCH_SEGMENT = /^(search|job-?search|search-?jobs|find-?jobs|openings|positions|opportunities|all-?jobs|jobs|listings|results)$/i;

/**
 * A careers page on the company's own domain. Job search pages (a jobs.
 * subdomain, or a /jobs or /search path) score higher than a bare /careers
 * page, which is often marketing that links out to the real board.
 */
function matchCompanySite(url: URL, variants: string[], domainTrusted = false): ScoredBoard | null {
  const host = url.hostname.toLowerCase();
  if (isDomainIn(host, NON_BOARD_DOMAINS) || isDomainIn(host, ATS_DOMAINS)) return null;

  const labels = host.split(".");
  if (!domainTrusted) {
    // Every label except the TLD may carry the name: careers.acme.com, acme.co.uk.
    const nameLabels = labels.slice(0, -1).filter((l) => !CAREERS_SUBDOMAINS.has(l) && l !== "www");
    if (!nameLabels.some((label) => namesMatch(variants, label))) return null;
  }

  const segs = url.pathname.split("/").filter(Boolean);
  const onCareersHost = CAREERS_SUBDOMAINS.has(labels[0]);
  const careersIdx = segs.findIndex((s) => CAREERS_SEGMENT.test(s));
  if (!onCareersHost && careersIdx === -1) return null;

  // How far the path goes into job search: /careers/search, /jobs, /en/jobs.
  const searchIdx = segs.findIndex((s, i) => i >= Math.max(careersIdx, 0) && SEARCH_SEGMENT.test(s));
  if (searchIdx !== -1) {
    return {
      boardUrl: `https://${host}/${segs.slice(0, searchIdx + 1).join("/")}`,
      atsType: "company-site",
      score: SCORE.jobSearchPage,
    };
  }
  if (onCareersHost) {
    return { boardUrl: `https://${host}`, atsType: "company-site", score: SCORE.jobSearchPage };
  }
  return {
    boardUrl: `https://${host}/${segs.slice(0, careersIdx + 1).join("/")}`,
    atsType: "company-site",
    score: SCORE.careersPage,
  };
}

/** True if a job-board account name or domain label plausibly names the company. */
export function namesMatch(variants: string[], candidate: string): boolean {
  const c = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (c.length < 2) return false;
  return variants.some((key) => {
    if (c === key) return true;
    // "stripe" vs "stripeinc", "palantir" vs "palantirtechnologies" — but not
    // "apple" vs "applebees": the leftover must be a generic word.
    const [shorter, longer] = c.length < key.length ? [c, key] : [key, c];
    return (
      shorter.length >= 3 &&
      longer.startsWith(shorter) &&
      GENERIC_NAME_TAILS.has(longer.slice(shorter.length))
    );
  });
}

const GENERIC_NAME_TAILS = new Set([
  "inc", "co", "corp", "hq", "ai", "io", "app", "labs", "tech", "technologies",
  "technology", "group", "global", "us", "usa", "careers", "career", "jobs", "talent",
  "hiring", "team", "external", "software", "systems", "health", "bank",
]);

export function isDomainIn(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".");
  // Rough handling of two-part suffixes like co.uk / com.au.
  const twoPart =
    labels.length >= 3 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3;
  return labels.slice(twoPart ? -3 : -2).join(".");
}
