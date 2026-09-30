import Firecrawl from "@mendable/firecrawl-js";

export function firecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

function client() {
  return new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY, maxRetries: 1 });
}

/**
 * Milliseconds to let a page's JavaScript render before reading it. Firecrawl
 * waits this long after load; the request timeout grows to match.
 */
export type RenderWait = number;

export interface ExtractedPosting {
  isJobPosting: boolean;
  title: string | null;
  location: string | null;
  pay: string | null;
}

const POSTING_SCHEMA = {
  type: "object",
  properties: {
    isJobPosting: {
      type: "boolean",
      description: "True only if this page is a single, specific job posting (not a list of jobs or a general careers page).",
    },
    title: { type: ["string", "null"], description: "The job title." },
    location: {
      type: ["string", "null"],
      description: "Where the job is based, as stated (e.g. \"Austin, TX\", \"Remote (US)\"). Null if not stated.",
    },
    pay: {
      type: ["string", "null"],
      description: "Compensation exactly as the posting states it, with currency and period (e.g. \"$120,000 - $150,000 per year\", \"$18.50/hour\"). Null if the posting does not state pay. Never estimate.",
    },
  },
  required: ["isJobPosting", "title", "location", "pay"],
};

/** Reads one posting page and extracts its key fields. */
export async function extractPosting(url: string, waitFor: RenderWait = 0): Promise<ExtractedPosting> {
  const doc = await client().scrape(url, {
    formats: [
      {
        type: "json",
        schema: POSTING_SCHEMA,
        prompt: "Extract the job title, location, and stated pay from this job posting. Leave pay null unless the page states it.",
      },
    ],
    onlyMainContent: true,
    ...(waitFor > 0 ? { waitFor } : {}),
    timeout: 25_000 + waitFor, // ms
    autoResume: false,
  });
  const j = asRecord(doc.json);
  return {
    isJobPosting: j.isJobPosting === true,
    title: cleanText(j.title, 150),
    location: cleanText(j.location, 120),
    pay: cleanText(j.pay, 120),
  };
}

export interface ListedPosting {
  title: string;
  location: string | null;
  url: string;
}

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    postings: {
      type: "array",
      description: "Every individual job posting listed on this page.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          location: { type: ["string", "null"] },
          url: { type: "string", description: "The link to the posting's own page." },
        },
        required: ["title", "location", "url"],
      },
    },
  },
  required: ["postings"],
};

/**
 * Reads a job board or search results page (after its JavaScript renders)
 * and lists the postings on it. Relative links are resolved against the page.
 */
export async function listPostings(pageUrl: string, waitFor: RenderWait): Promise<ListedPosting[]> {
  const doc = await client().scrape(pageUrl, {
    formats: [
      {
        type: "json",
        schema: LISTING_SCHEMA,
        prompt: "List every individual job posting shown on this page with its title, location, and link. Return an empty list if no postings are shown.",
      },
    ],
    waitFor,
    timeout: 30_000 + waitFor,
    autoResume: false,
  });
  const raw = asRecord(doc.json).postings;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const p = asRecord(item);
    const title = cleanText(p.title, 150);
    const url = typeof p.url === "string" ? absoluteUrl(p.url, pageUrl) : null;
    return title && url ? [{ title, location: cleanText(p.location, 120), url }] : [];
  });
}

/** Every link on a page, after its JavaScript renders. */
export async function pageLinks(pageUrl: string, waitFor: RenderWait): Promise<string[]> {
  const doc = await client().scrape(pageUrl, {
    formats: ["links"],
    waitFor,
    timeout: 25_000 + waitFor,
    autoResume: false,
  });
  return (doc.links ?? []).flatMap((l) => absoluteUrl(l, pageUrl) ?? []);
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function cleanText(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
}
