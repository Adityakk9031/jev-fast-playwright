# jev-fast-playwright

Drop-in **MCP server** for any coding agent. Fast, **low-token** UI testing:

compressed DOM → Jev System-1 (or heuristic) → Playwright action.

No deep integration. Register the MCP, call the tools, get short JSON results.

```
Any coding agent  ──MCP stdio──▶  jev-fast-playwright  ──▶  Chrome
                                     │
                                     ├─ compressDOM (tiny JSON)
                                     ├─ Jev / heuristic select
                                     └─ navigate · click · type · scroll
```

## Why this vs a Playwright agent

| Playwright-style agent | jev-fast-playwright |
|------------------------|---------------------|
| Large HTML / screenshots into the LLM | Compressed interactive list only |
| High token burn per step | Short JSON tool replies |
| Slow “see page → plan → click” | System-1 pick + one click |

## Quick start

```powershell
cd d:\jev_bridge
npm install
npm run build
npm run demo          # Chrome → Demoblaze → click Laptops → artifacts/demo_report.json
```

## Use with Cursor (or any MCP agent)

**Cursor config** (this machine): `C:\Users\user\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "jev-fast-playwright": {
      "command": "node",
      "args": ["d:/jev_bridge/build/src/index.js"],
      "env": {
        "JEV_API_KEY": "your_key_here",
        "PLAYWRIGHT_CHANNEL": "chrome",
        "PLAYWRIGHT_HEADLESS": "false",
        "JEV_BROWSER_MODE": "launch",
        "JEV_USER_DATA_DIR": "C:\\ChromeDebugJev",
        "JEV_CONFIDENCE_THRESHOLD": "0.75"
      }
    }
  }
}
```

Prompt the agent:

> Use ONLY `jev-fast-playwright`.  
> Navigate to https://www.demoblaze.com, click Laptops, return tool JSON only.

Reload MCP / restart the agent after `npm run build` or config changes.

## MCP tools

| Tool | Purpose |
|------|---------|
| `jev_browser_status` | Ready / mode / URL |
| `jev_navigate` | Open URL (launches Chrome in `launch` mode) |
| `jev_fast_click` | Natural-language click |
| `jev_type` | Natural-language type |
| `jev_page_snapshot` | Compressed interactive elements |
| `jev_scroll` / `jev_wait` / `jev_press_key` | Helpers |
| `jev_screenshot` | PNG (use sparingly — tokens) |

## Environment

Copy `.env.example` → `.env`. Important keys:

| Variable | Default | Notes |
|----------|---------|--------|
| `JEV_API_KEY` | required | Never hardcode in source |
| `JEV_BROWSER_MODE` | `launch` | Opens Chrome itself |
| `PLAYWRIGHT_CHANNEL` | `chrome` | Or `msedge` / `chromium` |
| `JEV_USER_DATA_DIR` | `C:\ChromeDebugJev` | Isolated profile |
| `JEV_CONFIDENCE_THRESHOLD` | `0.75` | Auto-click gate |
| `JEV_BROWSER_MODE=attach` | optional | CDP to an already-open browser |

## Project layout

```
d:\jev_bridge\
├── src\                 MCP server + browser + Jev client
├── build\               Compiled output (what MCP runs)
├── demo\run_demo.ts     Agent-free end-to-end demo
├── test\                Extra scripts / smoke tests
├── artifacts\           demo_report.json etc.
├── context.md           Older Antigravity session notes
├── context2.md          Current Cursor / agent-agnostic session
├── .env                 Local secrets (git-ignored)
└── package.json
```

## Scripts

```powershell
npm run build           # SWC compile → build/
npm start               # MCP server on stdio
npm run demo            # Low-token Demoblaze demo + report
npm test                # Headless integration checks (browser needed)
npm run test:heuristic  # Pure heuristic-selection unit tests (no browser)
npm run test:adidas     # Real-MCP E2E: Adidas search → product-card click (opens Chrome)
```

## Proven results (this machine)

- **Demoblaze** via `npm run demo`: ~8.4s total, Laptops click OK (re-verified after the heuristic rewrite)
- **Demoblaze** via Cursor MCP: navigate ~3.7s, Laptops click ~1.9s
- **Adidas** (previously flaky): navigate + search "running shoes" OK, and **product-card clicks now work** —
  `jev_fast_click "open the first running shoes product card"` clicks the Adizero card (0.84 confidence,
  heuristic) and lands on the product page, skipping the nav "Shoes" link and collection tiles
  (verified live via `npm run test:adidas`, 2026-09-28)

## How selection works (heuristic fallback)

When the Jev API is unreachable, the built-in heuristic ranks elements by:
distinctiveness-weighted token overlap (rare words like "adizero" outweigh generic ones),
specificity-scaled phrase matches, a `zone` prior (header / main / footer — computed by
`compressDOM`), "not X" exclusion parsing, and a query-echo penalty so a page title like
"Running Shoes" loses to an actual product card. See `test/heuristicTest.ts` for the pinned cases.

## Known limits

- Element selection uses the **TypeSafe System-1 API** (`api.typesafe.ai/v1/systemone`, model `jev-latest`);
  if it's unreachable the local heuristic takes over (`selector_source` tells you which: `jev` vs `heuristic`)
- Very vague targets ("click it") intentionally stay below the confidence gate — describe the
  element by its visible text for a reliable click
- Complex SPAs (Adidas) hydrate lazily: `jev_type` / `jev_fast_click` recompress once if the
  page looks empty, but a first call right after navigation can still miss — wait or retry
- Profile lock: close other Chrome using `C:\ChromeDebugJev` if launch fails
- Bundled-browser lookups (chromium channel / `npm test`) follow `PLAYWRIGHT_BROWSERS_PATH`;
  this machine keeps them at `D:\tools\playwright-browsers` (C: is nearly full)

## Design rule

Agent-agnostic MCP bridge. Prefer JSON-small tool results. Avoid screenshots unless debugging.
