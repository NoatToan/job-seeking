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

```bash
uv sync
uv run pytest && uv run ruff check .
```

Open Claude Code at the repo root, approve the two servers from `.mcp.json`, check with `/mcp`, then
ask e.g. "tìm job contract React trên SEEK ở Sydney 7 ngày qua" or "search_freelance_jobs python".

## Caveats

- **LinkedIn is blocked by ISPs in Vietnam** (TLS connection reset). Use a VPN, or pass `proxies`
  to jobspy's `search_jobs`.
- Unofficial endpoints: a layout or API change makes that tool error out (Arc raises when
  `__NEXT_DATA__` is missing) rather than return wrong data. Keep volume low.
- WWR feeds hold only the latest ~100 postings and few are typed "Contract"; category feeds carry
  no `<type>` at all, so filter by `job_type` only with `category="all"`.
- Arc redirects skill aliases (`react` → `reactjs`) and drops the query string; the tool re-applies
  `jobTypes`. Unknown skills fall back to the generic list, filtered locally by the skill word.
