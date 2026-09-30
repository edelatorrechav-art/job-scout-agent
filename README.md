# Job Scout

A chat agent that finds open jobs at companies you choose. Built with Next.js (App Router), Tailwind CSS, and the Anthropic Claude API; deployed on Vercel.

**Status: phase 2** — streaming chat plus employer tracking (`update_employer_list`). Job search (`find_open_roles`) comes next.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY and TAVILY_API_KEY
npm run dev                  # http://localhost:3000
```

On Vercel, add the same variables under **Project Settings → Environment Variables**. They are read only on the server; never prefix them with `NEXT_PUBLIC_`.

## How it works

- `app/api/chat/route.ts` — the only server endpoint. Receives the conversation, streams Claude's reply back as newline-delimited JSON events (`text`, then `done` / `refusal` / `error`; see `lib/chat/protocol.ts`).
- `components/ChatWindow.tsx` — the chat UI. It holds the conversation in memory and sends the whole history with each message. Assistant turns are stored exactly as the server returned them, including thinking blocks, because the API expects them back unchanged.
- `lib/agent/config.ts` — model (`claude-opus-5-5`), effort, and the server-side refusal fallback (`fallbacks: "default"`), which retries on another model if a safety classifier declines a request.
- `lib/agent/systemPrompt.ts` — kept free of dates or per-user data so it stays in the prompt cache.
- `lib/chat/history.ts` — validates what the browser sends, and prepares assistant content for echoing back.

### Employer list

- Stored in the browser's `localStorage` (`lib/employers/store.ts`) and sent with every message. Shown as chips under the header; × removes a company.
- `update_employer_list` (`lib/agent/tools/updateEmployerList.ts`) has three modes: `add` (default), `replace` (only when the user clearly asks to start over), and `remove`. After an add or replace the list must hold at least 2 companies (max 25).
- New companies are looked up with Tavily; `lib/employers/boardResolver.ts` picks the job board from the results, preferring hosted boards (Greenhouse, Lever, Ashby, Workday, …) whose account name matches the company, then a careers page on the company's own domain. Companies with no board found stay on the list; adding them again retries the lookup.
- The route runs the tool loop itself (`app/api/chat/route.ts`) and streams `status` and `employers` events so the UI shows progress and saves changes immediately.
- Each turn, if the list changed since Claude last saw it, the server appends a `[Tracked employers]` system message with the current list. It's returned to the browser and kept in the history, which stays append-only.

## Roadmap

1. ✅ Streaming chat, no tools
2. ✅ Employer list in `localStorage` + `update_employer_list` (Tavily): adds by default, replaces only on explicit request, supports removing a company
3. `find_open_roles` (Tavily + Firecrawl): up to 5 postings per company by default, more on request
4. Results table, tool status messages, employer sidebar
5. Hardening: rate limiting, timeouts, test prompts
