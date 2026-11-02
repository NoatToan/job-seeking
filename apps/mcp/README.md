# job_search_mcp

MCP server that lets Claude Code search jobs live, for free: no API keys, no browser, no database.
Registered in the repo-root `.mcp.json` together with [jobspy-mcp](https://github.com/andrijdavid/jobspy-mcp).

| Tool | Platform | Data source |
|---|---|---|
| `search_seek` | SEEK AU / NZ | Public JSON API the SEEK website calls (`/api/jobsearch/v5/search`) |
| `search_weworkremotely` | We Work Remotely | Public RSS feeds |
| `search_arc` | Arc.dev | `__NEXT_DATA__` JSON in the server-rendered listing pages |
| `search_freelance_jobs` | All three, contract only | Runs the three above in parallel |
| `jobspy` → `search_jobs` | LinkedIn, Glassdoor, Indeed, Google Jobs | jobspy-mcp (`uvx jobspy-mcp`) |
| `upwork` (official) | Upwork | Upwork's own MCP server `https://mcp.upwork.com/mcp` (OAuth sign-in) |

```bash
uv sync
uv run pytest && uv run ruff check .
```

## Your own data (personal access token, M3-08)

Set `UJC_API_URL` and `UJC_TOKEN` (see `.env.example`) to enable six more tools that call *your
own* unified-job-crawler deployment on your behalf, authenticated with a personal access token
instead of your browser session:

| Tool | Calls | Scope needed |
|---|---|---|
| `my_feed(cursor?, q?)` | `GET /api/feed` | `jobs:read` |
| `my_job(job_id)` | `GET /api/jobs/{id}` | `jobs:read` |
| `my_live_search(q, cursor?)` | `GET /api/search/live` | `jobs:read` |
| `my_applications(status?)` | `GET /api/applications` | `applications:write` |
| `save_job(job_id, note?)` | `POST /api/applications` | `applications:write` |
| `update_application(id, status?, note?)` | `PATCH /api/applications/{id}` | `applications:write` |

Get a token from the web app's **Account → Personal access tokens** page: pick a name, tick only
the scopes you actually need (least privilege — most people only need `jobs:read`), set an
expiry, and copy the `ujc_pat_...` value shown once. Put it in `UJC_TOKEN`; it is never logged or
echoed back by any tool, including in error messages.

```bash
# .env.local (repo root) or your shell profile — never commit a real token
UJC_API_URL=https://jobs.example.com   # or http://localhost:8000 against a local API
UJC_TOKEN=ujc_pat_...
```

Then restart Claude Code (or run `/mcp` to reconnect `job-search`) so it picks up the new env
vars. If either variable is unset, these six tools simply don't appear — the free-source tools
above keep working exactly as before. A revoked or expired token, or one missing the needed
scope, doesn't break the connection: the call just returns `{"error": "..."}`, same shape as any
other tool result.

This sits next to Upwork's own official MCP server (`upwork` above) and `jobspy`: all three are
registered in the same `.mcp.json`, so Claude Code can mix results from your own data and from
every live source in one conversation.

Open Claude Code at the repo root, approve the two servers from `.mcp.json`, check with `/mcp`, then
ask e.g. "tìm job contract React trên SEEK ở Sydney 7 ngày qua" or "search_freelance_jobs python".

## Upwork (official MCP)

`.mcp.json` also registers Upwork's official MCP server (Streamable HTTP, free). It signs in with your
own Upwork account: in Claude Code run `/mcp`, pick `upwork` and finish the OAuth login in the browser.
No API key or secret is stored in this repo.

Use it only for your own on-demand searches. The Upwork API & MCP Terms forbid continuous
monitoring/polling, caching Upwork content for more than 24 hours, and using Upwork content to train,
ground or evaluate AI models. That's why Upwork jobs are never crawled into our database or scored
against CVs (see `docs/product/ARCHITECTURE.md` §7).

## Caveats

- **LinkedIn is blocked by ISPs in Vietnam** (TLS connection reset). Use a VPN, or pass `proxies`
  to jobspy's `search_jobs`.
- Unofficial endpoints: a layout or API change makes that tool error out (Arc raises when
  `__NEXT_DATA__` is missing) rather than return wrong data. Keep volume low.
- WWR feeds hold only the latest ~100 postings and few are typed "Contract"; category feeds carry
  no `<type>` at all, so filter by `job_type` only with `category="all"`.
- Arc redirects skill aliases (`react` → `reactjs`) and drops the query string; the tool re-applies
  `jobTypes`. Unknown skills fall back to the generic list, filtered locally by the skill word.
