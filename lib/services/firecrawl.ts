import Firecrawl from "@mendable/firecrawl-js";

export function firecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

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
      description: "Compensation exactly as the posting states it, with currency and period (e.g. \"$120,000 - $150,000 per year\"). Null if the posting does not state pay. Never estimate.",
    },
  },
  required: ["isJobPosting", "title", "location", "pay"],
};

/** Reads one posting page with Firecrawl and extracts its key fields. */
export async function extractPosting(url: string): Promise<ExtractedPosting> {
  const client = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY, maxRetries: 1 });
  const doc = await client.scrape(url, {
    formats: [
      {
        type: "json",
        schema: POSTING_SCHEMA,
        prompt: "Extract the job title, location, and stated pay from this job posting. Leave pay null unless the page states it.",
      },
    ],
    onlyMainContent: true,
    timeout: 25_000, // ms
    autoResume: false,
  });
  return normalize(doc.json);
}

function normalize(json: unknown): ExtractedPosting {
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
  return {
    isJobPosting: j.isJobPosting === true,
    title: text(j.title, 150),
    location: text(j.location, 120),
    pay: text(j.pay, 120),
  };
}
