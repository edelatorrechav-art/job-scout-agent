import { companyKey, type AtsType } from "@/lib/employers/types";

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
];

/**
 * Picks the company's job board from search result URLs (in rank order).
 * A hosted job board (Greenhouse, Lever, ...) whose account name matches the
 * company wins; otherwise a careers page on a domain matching the company.
 * Returns null if nothing plausible is found.
 */
export function pickBoard(companyName: string, urls: string[]): BoardMatch | null {
  const key = companyKey(companyName);
  if (!key) return null;
  const parsed = urls.flatMap((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" ? [url] : [];
    } catch {
      return [];
    }
  });

  for (const url of parsed) {
    const ats = matchAts(url);
    if (ats && namesMatch(key, ats.account)) return ats.board;
  }
  for (const url of parsed) {
    const site = matchCompanySite(url, key);
    if (site) return site;
  }
  return null;
}

interface AtsHit {
  account: string;
  board: BoardMatch;
}

function matchAts(url: URL): AtsHit | null {
  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split("/").filter(Boolean);
  const firstLabel = host.split(".")[0];
  const hit = (account: string | undefined | null, boardUrl: string, atsType: AtsType) =>
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
    return hit(firstLabel.replace(/^careers-/, ""), `https://${host}/jobs`, "icims");
  }
  if (host.endsWith(".bamboohr.com")) {
    return hit(firstLabel, `https://${host}/careers`, "bamboohr");
  }
  if (host.endsWith(".recruitee.com")) {
    return hit(firstLabel, `https://${host}`, "recruitee");
  }
  return null;
}

const CAREERS_SUBDOMAINS = new Set(["careers", "jobs", "job", "work", "join"]);
const CAREERS_PATH = /^(careers?|jobs|join(-us)?|work-with-us|opportunities)$/i;

function matchCompanySite(url: URL, key: string): BoardMatch | null {
  const host = url.hostname.toLowerCase();
  if (isDomainIn(host, NON_BOARD_DOMAINS) || isDomainIn(host, ATS_DOMAINS)) return null;

  // Every label except the TLD must be checked: careers.acme.com, acme.co.uk.
  const labels = host.split(".");
  const nameLabels = labels.slice(0, -1).filter((l) => !CAREERS_SUBDOMAINS.has(l) && l !== "www");
  if (!nameLabels.some((label) => namesMatch(key, label))) return null;

  if (CAREERS_SUBDOMAINS.has(labels[0])) {
    return { boardUrl: `https://${host}`, atsType: "company-site" };
  }
  const segs = url.pathname.split("/").filter(Boolean);
  const idx = segs.findIndex((s) => CAREERS_PATH.test(s));
  if (idx === -1) return null;
  return {
    boardUrl: `https://${host}/${segs.slice(0, idx + 1).join("/")}`,
    atsType: "company-site",
  };
}

/** True if a job-board account name or domain label plausibly names the company. */
function namesMatch(key: string, candidate: string): boolean {
  const c = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (c.length < 2) return false;
  if (c === key) return true;
  // "stripe" vs "stripeinc", "palantir" vs "palantirtechnologies" — but not
  // "apple" vs "applebees": the leftover must be a generic word.
  const [shorter, longer] = c.length < key.length ? [c, key] : [key, c];
  return (
    shorter.length >= 3 &&
    longer.startsWith(shorter) &&
    GENERIC_NAME_TAILS.has(longer.slice(shorter.length))
  );
}

const GENERIC_NAME_TAILS = new Set([
  "inc", "co", "corp", "hq", "ai", "io", "app", "labs", "tech", "technologies",
  "technology", "group", "global", "us", "usa", "careers", "jobs", "talent",
  "hiring", "team", "external", "software", "systems", "health", "bank",
]);

export function isDomainIn(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
