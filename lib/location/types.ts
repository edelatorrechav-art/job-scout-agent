// A location filter for job searches. Also the shape saved in localStorage.

export interface LocationPref {
  /** City, state, or region, e.g. "Oklahoma City, OK". Null means none. */
  place: string | null;
  /** Include remote roles. With no place, it means remote roles only. */
  remote: boolean;
}

export const MAX_PLACE_CHARS = 100;

export function isLocationPref(value: unknown): value is LocationPref {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const placeOk =
    v.place === null ||
    (typeof v.place === "string" && v.place.trim() !== "" && v.place.length <= MAX_PLACE_CHARS);
  return placeOk && typeof v.remote === "boolean" && (v.place !== null || v.remote);
}

/** "Oklahoma City, OK", "Oklahoma City, OK or remote", "Remote only", "All locations". */
export function describeLocation(pref: LocationPref | null): string {
  if (!pref) return "All locations";
  if (!pref.place) return "Remote only";
  return pref.remote ? `${pref.place} or remote` : pref.place;
}

/**
 * Turns what the user or Claude said into a filter. "remote" alone means
 * remote-only; "anywhere"/"all" or empty means no filter.
 */
export function parseLocation(text: string | null, includeRemote: boolean): LocationPref | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PLACE_CHARS);
  if (/^(remote|remote only|work from home|wfh)$/i.test(t)) return { place: null, remote: true };
  if (!t || /^(anywhere|any|all|all locations|everywhere|none)$/i.test(t)) {
    return includeRemote ? { place: null, remote: true } : null;
  }
  return { place: t, remote: includeRemote };
}
