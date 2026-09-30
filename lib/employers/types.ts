// Shared by the browser (localStorage) and the server (tool input/output).

export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "smartrecruiters",
  "workable",
  "jobvite",
  "icims",
  "bamboohr",
  "recruitee",
  "ultipro",
  "taleo",
  "successfactors",
  "dayforce",
  "oracle",
  "adp",
  "company-site",
] as const;

export type AtsType = (typeof ATS_TYPES)[number];

export interface Employer {
  name: string;
  /** Root of the company's job board, or null if none was found. */
  boardUrl: string | null;
  atsType: AtsType | null;
  /** ISO timestamp of the last lookup. */
  resolvedAt: string;
}

export const MAX_EMPLOYERS = 25;
export const MAX_COMPANY_NAME_CHARS = 80;

export function isEmployer(value: unknown): value is Employer {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.name === "string" &&
    e.name.trim() !== "" &&
    e.name.length <= MAX_COMPANY_NAME_CHARS &&
    (e.boardUrl === null || (typeof e.boardUrl === "string" && isHttpsUrl(e.boardUrl))) &&
    (e.atsType === null || ATS_TYPES.includes(e.atsType as AtsType)) &&
    typeof e.resolvedAt === "string"
  );
}

export function isEmployerList(value: unknown): value is Employer[] {
  return (
    Array.isArray(value) && value.length <= MAX_EMPLOYERS && value.every(isEmployer)
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes a company name for matching: lowercase, alphanumerics only,
 * possessives folded ("Love's" and "Love’s" become "loves"), and common legal
 * suffixes removed. "Acme, Inc." and "acme" both become "acme".
 */
export function companyKey(name: string): string {
  return nameWords(name).join("");
}

/**
 * Keys a company might go by, longest first: the full name, then its leading
 * words. "Love's Travel Stops & Country Stores" gives "lovestravelstopsandcountrystores",
 * …, "lovestravel", "loves". A one-word prefix is only used if it's
 * distinctive (not "american", "first", …), so "American Airlines" never
 * reduces to "american".
 */
export function nameVariants(name: string): string[] {
  const words = nameWords(name);
  const variants: string[] = [];
  for (let n = words.length; n >= 1; n--) {
    const key = words.slice(0, n).join("");
    if (n === 1 && words.length > 1 && (key.length < 4 || GENERIC_FIRST_WORDS.has(key))) continue;
    if (n < words.length && ["and", "of", "the"].includes(words[n - 1])) continue;
    variants.push(key);
  }
  return [...new Set(variants)];
}

/**
 * True if two names refer to the same company: the same key, or one is a
 * distinctive leading part of the other ("Love's" and "Love's Travel Stops").
 */
export function sameCompany(a: string, b: string): boolean {
  const ka = companyKey(a);
  const kb = companyKey(b);
  if (!ka || !kb) return false;
  return ka === kb || nameVariants(a).includes(kb) || nameVariants(b).includes(ka);
}

/** The name without legal suffixes, for search queries ("Love's Travel Stops & Country Stores"). */
export function searchName(name: string): string {
  return name
    .replace(/[,.]?\s+(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc)\.?$/i, "")
    .trim();
}

function nameWords(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/['\u2019`]s\b/g, "s") // possessives
    .replace(/['\u2019`]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  return words;
}

const GENERIC_FIRST_WORDS = new Set([
  "american", "united", "national", "general", "first", "global", "international",
  "new", "north", "south", "east", "west", "central", "pacific", "atlantic",
  "great", "big", "best", "premier", "royal", "southern", "northern", "western",
  "eastern", "us", "usa", "the", "bank", "city", "state", "home",
]);

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "group",
  "holdings",
]);
