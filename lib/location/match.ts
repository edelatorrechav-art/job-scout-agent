import type { LocationPref } from "@/lib/location/types";

export type LocationVerdict =
  | "match" // posting is in the requested place (or remote, when allowed)
  | "remote-excluded" // remote-only posting, and remote wasn't asked for
  | "elsewhere" // posting states a location that doesn't match
  | "unknown"; // posting doesn't state a location

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};
const STATE_BY_NAME = new Map(
  Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]),
);

// Other ways postings name a country or region.
const REGION_ALIASES: string[][] = [
  ["united states", "usa", "us", "u.s.", "u.s.a."],
  ["united kingdom", "uk", "u.k.", "great britain", "england"],
  ["washington dc", "washington, dc", "washington d.c.", "district of columbia"],
];

const REMOTE = /\b(remote|work from home|wfh|anywhere|distributed|virtual)\b/i;
const NOT_STATED = /^(not listed|n\/a|none|unknown|tbd|multiple locations?|various)$/i;

/**
 * Decides whether a posting's stated location fits the filter. Matching is on
 * whole words: "Oklahoma" matches "Tulsa, OK" and "Oklahoma City, Oklahoma";
 * "Oklahoma City, OK" requires the city (and rejects other states).
 */
export function matchLocation(postingLocation: string, filter: LocationPref): LocationVerdict {
  const loc = postingLocation.trim();
  if (!loc || NOT_STATED.test(loc)) return "unknown";

  const onsiteText = loc.replace(new RegExp(REMOTE.source, "gi"), " ");
  const isRemote = REMOTE.test(loc);
  // "Remote" with nothing else, or "Remote - US": no specific place stated.
  const remoteOnly = isRemote && !hasSpecificPlace(onsiteText);

  if (filter.place && placeMatches(filter.place, onsiteText)) return "match";
  if (isRemote && filter.remote) return "match";
  if (remoteOnly) return "remote-excluded";
  if (!filter.place) return isRemote ? "match" : "elsewhere"; // remote-only filter
  return "elsewhere";
}

function placeMatches(place: string, loc: string): boolean {
  const parts = place.split(",").map((p) => p.trim()).filter(Boolean);
  const [first, ...rest] = parts;
  if (!first) return false;

  // A single state ("Oklahoma" or "OK") or region ("UK").
  if (parts.length === 1) {
    const state = stateAbbr(first);
    if (state) {
      // Explicit abbreviations win over names inside city names:
      // "Kansas City, MO" is in Missouri, "Oklahoma City, OK" in Oklahoma.
      const abbrs = statesByAbbreviation(loc);
      return abbrs.length > 0 ? abbrs.includes(state) : mentionsState(loc, state);
    }
    return mentionsPhrase(loc, first) || aliasesOf(first).some((a) => mentionsPhrase(loc, a));
  }

  // "City, ST" / "City, State" / "City, Country": the city must appear, and a
  // posting that names a different US state is rejected.
  if (!mentionsPhrase(loc, first)) return false;
  const state = rest.map(stateAbbr).find(Boolean);
  if (!state) return true;
  const abbrs = statesByAbbreviation(loc);
  const statesInPosting = abbrs.length > 0 ? abbrs : Object.keys(US_STATES).filter((s) => mentionsState(loc, s));
  return statesInPosting.length === 0 || statesInPosting.includes(state);
}

function statesByAbbreviation(loc: string): string[] {
  return Object.keys(US_STATES).filter((s) => new RegExp(`(^|[^A-Za-z])${s}([^A-Za-z]|$)`).test(loc));
}

function stateAbbr(text: string): string | null {
  const t = text.trim();
  if (/^[A-Za-z]{2}$/.test(t) && US_STATES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME.get(t.toLowerCase()) ?? null;
}

function mentionsState(loc: string, abbr: string): boolean {
  // Abbreviations must be uppercase whole words ("OK", "US-OK-Tulsa"), so
  // everyday words like "ok" or "in" don't count.
  return new RegExp(`(^|[^A-Za-z])${abbr}([^A-Za-z]|$)`).test(loc) || mentionsPhrase(loc, US_STATES[abbr]);
}

function mentionsPhrase(loc: string, phrase: string): boolean {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(loc);
}

function aliasesOf(phrase: string): string[] {
  const p = phrase.toLowerCase();
  return REGION_ALIASES.find((group) => group.includes(p)) ?? [];
}

function hasSpecificPlace(text: string): boolean {
  // Anything left besides country-level words and punctuation counts.
  const leftover = text
    .toLowerCase()
    .replace(/\b(united states|usa|us|u\.s\.a?\.?|north america|americas|emea|apac|global|worldwide|only|or|and|in|-)\b/g, " ")
    .replace(/[^a-z]+/g, "");
  return leftover.length > 0;
}
