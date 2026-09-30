// Decides which search results count as postings on a company's job board.

/** The domain to restrict searches to, e.g. "greenhouse.io" or "apple.com". */
export function searchDomain(boardUrl: string): string {
  return registrableDomain(new URL(boardUrl).hostname);
}

/**
 * True if `url` is a page on the board other than its index. Hosted boards
 * (a path like /stripe on greenhouse.io) must stay under that path, since the
 * same host serves other companies. A company's own site may put postings on
 * a sibling host (apple.com/careers → jobs.apple.com), so any host on the
 * same domain counts.
 */
export function isOnBoard(url: string, boardUrl: string, hostedBoard: boolean): boolean {
  let u: URL, board: URL;
  try {
    u = new URL(url);
    board = new URL(boardUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const path = u.pathname.replace(/\/+$/, "");
  const boardPath = board.pathname.replace(/\/+$/, "");
  if (u.hostname === board.hostname && path === boardPath) return false; // the index itself
  if (hostedBoard) {
    return (
      u.hostname === board.hostname &&
      (path.toLowerCase().startsWith(boardPath.toLowerCase() + "/") || boardPath === "")
    );
  }
  return registrableDomain(u.hostname) === registrableDomain(board.hostname);
}

function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".");
  // Rough handling of two-part suffixes like co.uk / com.au.
  const twoPart =
    labels.length >= 3 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3;
  return labels.slice(twoPart ? -3 : -2).join(".");
}
