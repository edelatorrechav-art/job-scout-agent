# Job Scout

A chat agent that finds open jobs at companies you choose. Built with Next.js (App Router), Tailwind CSS, and the Anthropic Claude API; deployed on Vercel.

**Status: phase 3** — streaming chat, employer tracking (`update_employer_list`), and job search (`find_open_roles`).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in all three API keys
npm run dev                  # http://localhost:3000
```

On Vercel, add the same variables under **Project Settings → Environment Variables**. They are read only on the server; never prefix them with `NEXT_PUBLIC_`.

## How it works

- `app/api/chat/route.ts` — the only server endpoint. Receives the conversation, streams Claude's reply back as newline-delimited JSON events (`text`, then `done` / `refusal` / `error`; see `lib/chat/protocol.ts`).
- `components/ChatWindow.tsx` — the chat UI. It holds the conversation in memory and sends the whole history with each message. Assistant turns are stored exactly as the server returned them, including thinking blocks, because the API expects them back unchanged.
- `lib/agent/config.ts` — model (`claude-opus-5-5`), effort, and the server-side refusal fallback (`fallbacks: "default"`), which retries on another model if a safety classifier declines a request.
- `lib/agent/systemPrompt.ts` — kept free of dates or per-user data so it stays in the prompt cache.
- `lib/chat/history.ts` — validates what the browser sends, and prepares assistant content for echoing back.

### Job search

- `find_open_roles` (`lib/agent/tools/findOpenRoles.ts`) takes a job type, an optional location and remote flag, an optional subset of saved companies, and an optional per-company limit (default 5, max 10; 40 postings max per search).
- Each company is searched in stages, stopping at the first that yields readable postings:
  1. A Tavily search restricted to the board's domain; `lib/jobs/boardScope.ts` keeps only pages under that company's board (hosted boards share hosts, so the account path or parameter must match).
  2. The board page itself, read by Firecrawl after its JavaScript renders (`waitFor`), listing the postings shown; titles are loosely matched to the job type.
  3. A web-wide Tavily search for "[company] [job title] [location] job", keeping only postings on the company's own domains or on a hosted board under its name (aggregators excluded).
- Each posting is read with Firecrawl's JSON extraction (`lib/services/firecrawl.ts`) for title, location, and pay, waiting for JavaScript on boards that need it and retrying once with a longer wait if the page came back empty. Pages that aren't a single posting are dropped. Missing pay or location becomes "Not listed"; the link is always the URL that was read, never one taken from the page.
- Each company gets a status: `ok`, `no-matching-roles` (its openings were visible, none fit), or `board-unreadable` (with a reason). Claude never reports an unreadable board as "no roles found".
- Searches and page reads run in parallel with concurrency limits, and the tool stops at ~75 seconds, reporting anything unread. The chat route's `maxDuration` is 300 seconds.
- Claude presents the results as per-company tables (Title | Location | Pay | Link), drops titles that don't match the requested role, and notes companies with no results.

### Location filter

- A location can be given for one search ("financial analyst jobs in Oklahoma City") or saved as a standing preference ("I only want jobs in Oklahoma") with `set_location_preference`. The preference lives in `localStorage` (`lib/location/store.ts`), shows as a chip under the header (× clears it), and applies to every search until changed. A location in the request overrides it for that search; "anywhere" ignores it once.
- The location goes into the Tavily query. Extra postings are read per company (2× the limit, max 15) since some get filtered out.
- `lib/location/match.ts` keeps postings whose stated location matches: a state ("Oklahoma" or "OK") matches any city in it, "City, ST" requires the city and rejects other states, and remote-only postings are kept only when remote was asked for. Postings with no stated location are dropped when a filter is active. Counts of dropped postings are reported.
- Results start with "Filtered to: …". With no location set, Claude mentions that the user can narrow it down.

### Employer list

- Stored in the browser's `localStorage` (`lib/employers/store.ts`) and sent with every message. Shown as chips under the header; × removes a company.
- `update_employer_list` (`lib/agent/tools/updateEmployerList.ts`) has three modes: `add` (default), `replace` (only when the user clearly asks to start over), and `remove`. After an add or replace the list must hold at least 2 companies (max 25).
- New companies are looked up with Tavily; `lib/employers/boardResolver.ts` picks the job board from the results, preferring hosted boards (Greenhouse, Lever, Ashby, Workday, UKG/UltiPro, Taleo, SuccessFactors, Dayforce, Oracle, ADP, …) whose account name matches the company, then a job search page on the company's domain, then a general careers page. If only a careers page is found, its links are read (after rendering) to find the real job search, which is often a hosted board with an opaque account code.
- Names are matched with possessives folded and on their leading words, so "Love's Travel Stops & Country Stores" matches `loves.com` and a `loves` Workday tenant, while generic first words ("American …") never match alone.
- Adding a company that's already tracked re-checks its job board (using the name as given and the saved board as a starting point); a re-check that finds nothing better keeps the old board. Companies with no board found stay on the list.
- The route runs the tool loop itself (`app/api/chat/route.ts`) and streams `status` and `employers` events so the UI shows progress and saves changes immediately.
- Each turn, if the saved settings (employers + location) changed since Claude last saw them, the server appends a `[Saved settings]` system message (`lib/chat/settingsContext.ts`). It's returned to the browser and kept in the history, which stays append-only.

## Roadmap

1. ✅ Streaming chat, no tools
2. ✅ Employer list in `localStorage` + `update_employer_list` (Tavily): adds by default, replaces only on explicit request, supports removing a company
3. ✅ `find_open_roles` (Tavily + Firecrawl): up to 5 postings per company by default, more on request
4. Results table, tool status messages, employer sidebar
5. Hardening: rate limiting, timeouts, test prompts
