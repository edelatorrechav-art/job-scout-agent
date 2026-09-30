// Decides which URLs count as postings on a company's job board, and how to
// read that board.
import { atsAccountMatches, registrableDomain } from "@/lib/employers/boardResolver";
import type { AtsType } from "@/lib/employers/types";

export interface BoardRef {
  name: string;
  boardUrl: string;
  atsType: AtsType | null;
}

/** The domain to restrict searches to, e.g. "greenhouse.io" or "loves.com". */
export function searchDomain(boardUrl: string): string {
  return registrableDomain(new URL(boardUrl).hostname);
}

// Boards whose pages are plain HTML; everything else renders with JavaScript.
const SERVER_RENDERED: AtsType[] = ["greenhouse", "lever", "jobvite", "bamboohr", "recruitee", "smartrecruiters"];

/** Milliseconds to let a board's pages render before reading them. */
export function renderWait(atsType: AtsType | null): number {
  return atsType && SERVER_RENDERED.includes(atsType) ? 0 : 3000;
}

/**
 * True if `url` is a posting on this board (not the board's index page).
 *
 * Hosted boards share hosts across companies, so the URL must also be in the
 * company's part of the host: its first path segment (greenhouse.io/stripe),
 * two for Dayforce (/en-US/<tenant>), or its account parameter for
 * SuccessFactors and ADP. A company's own site may put postings on a sibling
 * host (loves.com/careers → jobs.loves.com), so any host on the same domain
 * counts — and so does a posting on a hosted job-board platform under an
 * account matching the company's name, since career sites often send you there.
 */
export function isOnBoard(url: string, ref: BoardRef): boolean {
  const { boardUrl, atsType } = ref;
  let u: URL, board: URL;
  try {
    u = new URL(url);
    board = new URL(boardUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (sameAddress(u, board)) return false; // the index itself

  if (!atsType || atsType === "company-site") {
    return (
      registrableDomain(u.hostname) === registrableDomain(board.hostname) ||
      atsAccountMatches(u, ref.name)
    );
  }

  if (u.hostname.toLowerCase() !== board.hostname.toLowerCase()) return false;
  if (atsType === "successfactors") return sameParam(u, board, "company");
  if (atsType === "adp") return sameParam(u, board, "cid");
  const depth = atsType === "dayforce" ? 2 : 1;
  const prefix = segments(board).slice(0, depth);
  const segs = segments(u);
  return prefix.every((p, i) => segs[i]?.toLowerCase() === p.toLowerCase());
}

function segments(u: URL): string[] {
  return u.pathname.split("/").filter(Boolean);
}

function sameAddress(a: URL, b: URL): boolean {
  const norm = (u: URL) =>
    `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "").toLowerCase()}${u.search}`;
  return norm(a) === norm(b);
}

function sameParam(a: URL, b: URL, name: string): boolean {
  const v = b.searchParams.get(name);
  return v !== null && a.searchParams.get(name) === v;
}
