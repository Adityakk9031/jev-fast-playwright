# JEV Fast Playwright — Session Context 2

> **Session dates:** 2026-09-27 → 2026-09-28  
> **Workspace:** `d:\jev_bridge`  
> **Focus:** Make the project a **generic MCP** for any coding agent (especially Cursor), not Antigravity-only. Prove low-token UI testing.

Related older notes: [`context.md`](./context.md) (Antigravity / Edge CDP era).

---

## What the project is (current)

**jev-fast-playwright** — MCP server any agent can call:

```
Coding agent (Cursor / Claude / …)
  → MCP tools (jev_navigate, jev_fast_click, …)
  → node d:/jev_bridge/build/src/index.js
  → Playwright Chrome (launch mode)
  → compressDOM → Jev API or heuristic → click/type
```

**Goal:** Same “open site and test UI” feel as a Playwright agent, but **faster and cheaper** (compressed DOM + System-1 pick, short JSON replies).

**Not required:** Embedding into an agent’s internal system — only MCP registration.

---

## Conversation arc (this chat)

| Phase | What happened |
|-------|----------------|
| Analysis | User asked to analyze project + `context.md` |
| Plan | Edge not opening / clicks failing under Antigravity attach; planned Phases 1–2 |
| Implement | Attach-first Edge CDP, heuristics, new tools, `launch_edge.bat` with `--user-data-dir` |
| Pain | Antigravity `attach` mode: `cdpReachable: false` → `BROWSER_NOT_ATTACHED` |
| User pivot | “I don’t care about Antigravity — open Chrome, restore chrome-devtools, make it launch” |
| Launch mode | `JEV_BROWSER_MODE=launch`, `PLAYWRIGHT_CHANNEL=chrome`, persistent profile `C:\ChromeDebugJev` |
| Agent-agnostic | README rewrite, `npm run demo`, Cursor `~/.cursor/mcp.json` |
| Test with Cursor | JEV MCP namespace `user-jev-fast-playwright` used live (not Cursor browser/Playwright agent) |
| Adidas test | Navigate + search worked; product click failed (heuristic picked nav “Shoes”) |

---

## Current recommended config

### `.env` / MCP env

```env
JEV_BROWSER_MODE=launch
PLAYWRIGHT_CHANNEL=chrome
PLAYWRIGHT_HEADLESS=false
JEV_USER_DATA_DIR=C:\ChromeDebugJev
JEV_CONFIDENCE_THRESHOLD=0.75
```

### Cursor MCP

**File:** `C:\Users\user\.cursor\mcp.json`  
Server name: `jev-fast-playwright` → runs `d:/jev_bridge/build/src/index.js`

### Antigravity MCP (optional / legacy)

**File:** `C:\Users\user\.gemini\antigravity\mcp_config.json`  
- `chrome-devtools-mcp` was **restored** by user request  
- `jev-fast-playwright` set to **launch + chrome** (not attach)

---

## How to test with Cursor (this agent)

1. Ensure MCP is enabled (`user-jev-fast-playwright` ready).  
2. After code changes: `npm run build`, reload MCP if needed.  
3. Prompt:

```text
Use ONLY jev-fast-playwright.
Navigate to <url>, do <actions>, return tool JSON only.
```

Do **not** ask for Cursor’s built-in browser / Playwright agent.

### Agent-free demo

```powershell
cd d:\jev_bridge
npm run build
npm run demo
```

Report: `artifacts/demo_report.json`

---

## Proven results

### Demoblaze — `npm run demo` (2026-09-28)

| Step | OK | ms |
|------|----|----|
| status / launch | ✅ | ~2069 |
| navigate | ✅ | ~3180 |
| snapshot (15 els) | ✅ | ~52 |
| click Laptops | ✅ | ~1882 |
| **Total** | **PASS** | **~8385** |

`selector_source`: heuristic (Jev API `fetch failed`)

### Demoblaze — Cursor MCP live

| Step | Result |
|------|--------|
| `jev_navigate` demoblaze | success ~3708 ms, title STORE |
| `jev_fast_click` Laptops | success ~1899 ms, confidence 0.84, heuristic |

### Adidas — Cursor MCP live (`https://www.adidas.com/us`)

| Step | Result |
|------|--------|
| `jev_navigate` | ✅ → `/us`, then title “Sneakers and Activewear \| adidas US” |
| `jev_page_snapshot` | ✅ 162 interactive elements (~565 ms) |
| `jev_type` “running shoes” into Search | ✅ |
| `jev_press_key` Enter | ✅ landed on `/us/running-shoes` |
| `jev_fast_click` product (Adizero…) | ❌ heuristic chose nav link **Shoes** (`jev-id=Y`); overlay intercepts pointer |

**Adidas takeaway:** Launch + search path works. Product-grid clicks need better selection (live Jev API, or heuristic that prefers product cards over in-page nav), and/or force-click / dismiss overlays.

---

## Architecture (key files)

| File | Role |
|------|------|
| `src/index.ts` | MCP tools, confidence gate, scroll/retry click |
| `src/browserManager.ts` | `attach` / `launch` / `auto`; persistent Chrome profile; ephemeral fallback if profile locked |
| `src/jevClient.ts` | Jev `/v1/select` + labeled heuristic (`source: jev\|heuristic`) |
| `src/utils/compressDOM.ts` | Stamp `jev-id`, return compact element JSON |
| `demo/run_demo.ts` | Standalone low-token demo |
| `launch_edge.bat` | Legacy CDP Edge helper (attach mode) |

### Browser modes

| Mode | Behavior |
|------|----------|
| `launch` | **Default now** — opens Chrome with `JEV_USER_DATA_DIR` |
| `attach` | CDP only (`JEV_CDP_URL`); fails loud if nothing on port |
| `auto` | Try CDP, then launch |

---

## Bugs / fixes in this session

1. **Attach-only Antigravity** → no Edge on 9222 → everything failed → switched to **launch Chrome**.  
2. **chrome-devtools-mcp** removed briefly (port fight) → **restored** per user.  
3. **Profile in use** (`Opening in existing browser session`) → kill Chrome or ephemeral launch fallback.  
4. **Heuristic confidence** capped; threshold **0.75** so strong fallbacks still click.  
5. **MCP name** → `jev-fast-playwright` (agent-agnostic packaging).

---

## Rules to follow

1. API key only from `.env` / MCP `env` — not hardcoded in source.  
2. Prefer `jev-fast-playwright` over built-in Playwright/browser agents when demoing this project.  
3. Keep tool replies small (no full-page dumps / vision unless debugging).  
4. Rebuild after `src/` changes: `npm run build`.  
5. `context.md` = Antigravity/CDP history; **`context2.md` = this Cursor / launch / demo era**.

---

## Open next work (not done)

- [x] Stabilize Adidas product-card clicks — **fixed 2026-09-28** (see fix session below); no longer needs the Jev API
- [ ] Optional: separate debug port if chrome-devtools-mcp and JEV both need CDP  
- [ ] Rotate any API keys that were pasted into chat logs / old context files  

---

## Quick prompt cheatsheet

**Demoblaze**

```text
Use ONLY jev-fast-playwright.
1) jev_navigate → https://www.demoblaze.com
2) jev_fast_click → Laptops
Return JSON only.
```

**Adidas smoke**

```text
Use ONLY jev-fast-playwright.
Navigate https://www.adidas.com/us
Type "running shoes" in search, press Enter
Then try to open a product card (not nav Shoes)
Return JSON only.
```

---

## Fix session — 2026-09-28 (click-action issue)

**Problem (from Adidas table above):** heuristic picked nav "Shoes" / page titles over product cards, and overlays could intercept pointer events.

**What changed**

1. `src/utils/compressDOM.ts` — every element now carries `zone` (`header` / `main` / `footer`), computed document-relative so below-the-fold cards are `main`, not `footer`.
2. `src/jevClient.ts` — heuristic rewritten: distinctiveness-weighted tokens, phrase bonus scaled by how much of the description the label explains, zone prior under content intents, "not X" exclusion parsing, specificity premium, and a query-echo penalty (page title "Running Shoes" / "Best Running Shoes" tile lose to real cards).
3. `src/index.ts` — click recovery ladder on failure: Escape + generic overlay dismissal ("Accept"/"Close"…) → retry → programmatic `el.click()` (bypasses hit-testing) → force click. Success JSON reports `click_strategy` + `dismissed_overlay`. `jev_type` / `jev_fast_click` recompress once if the SPA looks empty (hydration race).
4. Tooling: MCP SDK 1.0 → 1.30, zod → 3.25 (imports `zod/v4` in `index.ts`); tsc typecheck now passes clean; toolchain lives in `D:\tools` (`node` v24, `playwright-browsers`), C: was 98% full.

**Verification**

- `npm run test:heuristic` — 8 pinned cases, incl. nav-vs-card, negation, Demoblaze/cart/search regressions, echo penalty.
- `npm run test:adidas` — real MCP server over stdio: navigate → search → `jev_fast_click` clicked the **ADIZERO ADIOS PRO 5 card** (0.84, heuristic, strategy=direct) and landed on `…/adizero-adios-pro-5-running-shoes/KI8293.html`. **PASS** (2026-09-28).
- `npm run demo` — Demoblaze still clicks Laptops at 0.84. No regression.

**Note:** vague targets still correctly refuse to click (LOW_CONFIDENCE) — describe targets by visible text.

### Jev API wired to the real TypeSafe endpoint (same day)

- Diagnosis: the configured `api.jev.ai` **never existed** (NXDOMAIN via Google DNS; `jev.ai` itself is a parked page). The `.env` key was always valid — it was being sent nowhere.
- Real API found via docs.typesafe.ai: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, model `jev-latest` (resolves to `jev-1.13.0`). One `choice` question maps perfectly: `state` = intent, `criteria` = element id → description, answer = `choice` + `confidence`.
- `src/jevClient.ts` rewritten to the real schema (old fake `target_id`/`jev-turbo` shape removed; `TYPESAFE_API_KEY` env name also accepted). Heuristic fallback unchanged.
- Verified live on the Adidas flow: `selector_source: "jev"`, **confidence 1.0** on search box + product card, API latency ~0.5–1s per call, landed on the ADIZERO product page.
