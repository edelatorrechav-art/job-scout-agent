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
 * common legal suffixes removed. "Acme, Inc." and "acme" both become "acme".
 */
export function companyKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join("");
}

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
