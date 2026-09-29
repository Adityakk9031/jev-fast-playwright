# JEV Bridge MCP — Full Session Context

> **Session Date:** 2026-09-27  
> **Conversation ID:** `fae4c6f5-1e70-400a-83e7-10347250e5cd`  
> **Project Path:** `d:\jev_bridge`

---

## 🎯 What This Project Is

**JEV Bridge MCP** is a custom MCP (Model Context Protocol) server that bridges Antigravity (AI agent) to the JEV AI element-selection API for ultra-fast Playwright browser automation.

```
Antigravity (chat agent)
  → calls MCP tools (jev_navigate, jev_fast_click, etc.)
  → MCP Server (node d:/jev_bridge/build/src/index.js)
  → Playwright controls the browser
  → JEV API selects DOM elements by natural language description
  → Click/type/navigate executed on real browser page
```

**Why it exists:** Avoid using Antigravity's built-in playwright agent. Use JEV's System-1 fast decision model instead. This is faster because DOM is compressed before sending to JEV API.

---

## 📁 Project Structure

```
d:\jev_bridge\
├── src\
│   ├── index.ts              ← MCP server entry point (701 lines)
│   ├── browserManager.ts     ← Playwright browser singleton (191 lines)
│   ├── jevClient.ts          ← JEV API client + heuristic fallback
│   └── utils\
│       ├── compressDOM.ts    ← DOM compressor (stamps jev-id on elements)
│       └── logger.ts         ← stderr-only logger (never pollutes MCP stdio)
├── build\                    ← Compiled JS output (swc)
│   └── src\
│       └── index.js          ← What Antigravity actually runs
├── test\
│   ├── manualTest.ts         ← Basic unit tests (6 tests, all pass)
│   ├── run_demoblaze.ts      ← Demoblaze.com full flow test
│   ├── live_test.ts          ← 7-step live test
│   ├── visible_demo.ts       ← Edge headless:false demo (demoblaze)
│   ├── adidas_demo.ts        ← Adidas with Edge
│   ├── adidas_live.ts        ← Adidas — connects to user-opened Edge via CDP
│   └── launch_and_test.ts    ← All-in-one launcher (spawns Edge + runs test)
├── .env                      ← API key + config (SOURCE OF TRUTH)
├── launch_edge.bat           ← Helper bat to open Edge with --remote-debugging-port=9222
├── package.json
└── tsconfig.json
```

---

## 🔑 Environment & Config

### `.env` file (`d:\jev_bridge\.env`)
```env
JEV_API_KEY=apikey_2191d7bc09a6f0ca4281986995a43f07ffb3_e996ddea4c7ba38f98f49c7da75e5ae4d307bb7e403f58a662608960a5a0cd3d
PLAYWRIGHT_BROWSER_TYPE=chromium
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_LAUNCH_TIMEOUT=30000
PLAYWRIGHT_ACTION_TIMEOUT=10000
JEV_CONFIDENCE_THRESHOLD=0.85
LOG_LEVEL=info
```

> **RULE:** API key must ONLY come from `.env`. Never hardcode it anywhere.

### MCP Config (`C:\Users\user\.gemini\antigravity\mcp_config.json`)
```json
{
  "mcpServers": {
    "jev-fast-playwright": {
      "command": "node",
      "args": ["d:/jev_bridge/build/src/index.js"],
      "env": {
        "JEV_API_KEY": "<from .env>",
        "PLAYWRIGHT_HEADLESS": "false",
        "PLAYWRIGHT_BROWSER_TYPE": "chromium",
        ...
      }
    }
  }
}
```

> **Why `env` block in mcp_config.json?** Antigravity spawns the MCP server as a child process — it does NOT inherit the user's shell environment. So `JEV_API_KEY` must be explicitly passed via the `env` block, even though `.env` also has it.

---

## 🛠️ MCP Tools Available

| Tool | Description |
|------|-------------|
| `jev_navigate` | Navigate browser to a URL |
| `jev_page_snapshot` | Capture compressed DOM snapshot of current page |
| `jev_screenshot` | Take a PNG screenshot |
| `jev_fast_click` | Click element by natural language description |
| `jev_type` | Type text into an input field |

All tools are **lazily loaded** — schemas are read from `C:\Users\user\.gemini\antigravity\mcp\jev-fast-playwright\*.json`.

---

## 🐛 Bugs Fixed During This Session

### Bug 1 — Race Condition in `browserManager.ts`
**Problem:** Two concurrent `init()` calls created competing browser instances. The second init created an `about:blank` page that overwrote the `this.page` reference, making all `jev_fast_click` calls return `NO_PAGE_LOADED`.

**Fix:** Added `initPromise: Promise<void> | null` mutex field. `init()` now guards with `if (this.initPromise) return this.initPromise`. Split into `_doInit()` private method.

---

### Bug 2 — `PLAYWRIGHT_HEADLESS` Default Wrong
**Problem:** Old code: `process.env['PLAYWRIGHT_HEADLESS'] !== 'false'` → defaulted to `true` (headless).

**Fix:** Changed to `process.env['PLAYWRIGHT_HEADLESS'] === 'true'` → default is now `false` (visible).

---

### Bug 3 — MCP Transport Blocked by Browser Pre-warm
**Problem:** `browserManager.init()` was called BEFORE `server.connect(transport)`. The browser launch blocked the MCP handshake causing Antigravity to time out with `exit status 0xffffffff`.

**Fix:** Moved `server.connect(transport)` to run FIRST. Browser init moved to background (non-blocking).

---

### Bug 4 — CDP Auto-Connect
**Problem:** When user manually opened Chrome/Edge with `--remote-debugging-port=9222`, the MCP server would try to launch a NEW browser instead of connecting to the existing visible one.

**Fix:** `browserManager.ts` now checks `http://127.0.0.1:9222/json/version` first. If reachable → `connectOverCDP()`. If not → launch new browser.

---

### Bug 5 — API Key Not Loading
**Problem:** `import 'dotenv/config'` only works if cwd is `d:\jev_bridge`. Antigravity spawns the process with a different working directory.

**Fix:** Multi-path `dotenv.config()` calls:
```ts
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
```

---

## 🖥️ Browser Visibility Issue & Root Cause

**The Core Problem:** Antigravity runs as a background Windows service process. Any browser it launches via `child_process` or Playwright's `launch()` runs in a **non-interactive session** — the window exists but is **invisible to the user on the desktop**.

### Confirmed Evidence:
- `Get-Process chrome/msedge` shows processes with `MainWindowHandle = 0` → no visible window
- Screenshots captured correctly → browser IS running, just not visible
- `headless: false` does NOT help when the spawner has no desktop session

### The Working Solution:
**User must open the browser manually** with `--remote-debugging-port=9222 --user-data-dir=<fresh-path>`, then Playwright connects via CDP to that visible window.

**Command to open visible Edge:**
```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\EdgeDebug2" `
  --no-first-run `
  --start-maximized `
  https://www.adidas.com
```

> **CRITICAL:** `--user-data-dir` must point to a **fresh/different profile directory**. Without it, Edge uses an existing profile that ignores the debug port flag.

---

## ✅ Successful Demos Run

### Demo 1 — Demoblaze.com (via MCP tools directly)
- 7 steps: navigate → screenshot → snapshot → click product → screenshot → add to cart → screenshot
- All clicks succeeded with 96% confidence
- Performance: dom_compression ~8-15ms, total ~1600-2500ms per click

### Demo 2 — Demoblaze.com (visible Edge, `visible_demo.ts`)
- 5 steps completed in **19.1 seconds total**
- navigate → click Laptops → click Sony Vaio i5 → Add to cart (dialog accepted) → open Cart
- Edge visible on desktop via Playwright `channel: 'msedge'`

### Demo 3 — Adidas.com (visible Edge via CDP, `adidas_live.ts`)
- Connected to user-opened Edge on port 9222
- Loaded adidas.com → searched "running shoes" (typed in search bar) → scrolled → size button clicked
- Screenshots saved: `adidas_1_home.png` through `adidas_5_size.png`

---

## 📸 Screenshots Saved

| File | Content |
|------|---------|
| `demo1_home.png` | Demoblaze home page |
| `demo2_laptops.png` | Laptops category |
| `demo3_product.png` | Sony Vaio i5 product page |
| `demo4_added.png` | After "Add to cart" |
| `demo5_cart.png` | Cart page |
| `adidas_1_home.png` | Adidas.com homepage |
| `adidas_2_search.png` | Search bar with "running sho" typed |
| `adidas_3_product.png` | Search results page |
| `adidas_4_details.png` | Scrolled product details |
| `adidas_5_size.png` | Size selector clicked |

All screenshots at: `C:\Users\user\.gemini\antigravity\brain\fae4c6f5-1e70-400a-83e7-10347250e5cd\`

---

## 🏗️ Architecture Deep Dive

### How `jev_fast_click` Works
1. `page.evaluate(compressDOM)` — injects JS, stamps every interactive element with `jev-id="A"`, `"B"`, etc., returns compressed JSON array
2. Sends JSON to `https://api.jev.ai/v1/select` with `target_description` (natural language)
3. JEV API returns `{ choice: "A1", confidence: 0.96 }`
4. If `confidence >= threshold` (default 0.85): `page.locator('[jev-id="A1"]').click()`
5. If JEV API unreachable: **heuristic fallback** in `jevClient.ts` scores elements by text similarity

### JEV API Status
- Endpoint: `https://api.jev.ai/v1/select`
- Currently **unreachable** (TypeError: fetch failed)
- Heuristic fallback handles this gracefully — matches by text/aria labels

### Key Files to Know

| File | Purpose |
|------|---------|
| [`d:\jev_bridge\src\index.ts`](file:///d:/jev_bridge/src/index.ts) | MCP server, all 5 tool handlers |
| [`d:\jev_bridge\src\browserManager.ts`](file:///d:/jev_bridge/src/browserManager.ts) | Browser singleton, CDP auto-connect |
| [`d:\jev_bridge\src\jevClient.ts`](file:///d:/jev_bridge/src/jevClient.ts) | JEV API + heuristic fallback |
| [`d:\jev_bridge\src\utils\compressDOM.ts`](file:///d:/jev_bridge/src/utils/compressDOM.ts) | DOM compressor script |
| [`d:\jev_bridge\test\adidas_live.ts`](file:///d:/jev_bridge/test/adidas_live.ts) | Latest working demo |

---

## 🚀 How to Run

### Start MCP Server (Antigravity does this automatically)
```bash
node d:/jev_bridge/build/src/index.js
```

### Run a Live Test (requires Edge open with CDP)
```powershell
# Step 1: Open Edge with debug port
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:\EdgeDebug2" --no-first-run --start-maximized https://www.adidas.com

# Step 2: Run automation
cd d:\jev_bridge
npx ts-node --transpile-only test/adidas_live.ts
```

### Rebuild after code changes
```bash
cd d:\jev_bridge
npm run build
```

### Run unit tests
```bash
cd d:\jev_bridge
npm test
```

---

## ⚙️ Environment Details

| Item | Value |
|------|-------|
| Node.js | v22.16.0 (`C:\Program Files\nodejs\node.exe`) |
| Chrome | v153.0.8010.53 (`C:\Program Files\Google\Chrome\Application\chrome.exe`) |
| Edge | v154.0.4258.37 (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) |
| Playwright Chromium | `C:\Users\user\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe` |
| OS | Windows 10/11 |
| Project | `d:\jev_bridge` |

---

## 📋 User Rules (Must Follow Always)

1. **API key ONLY from `d:\jev_bridge\.env`** — never hardcode
2. **Use ONLY `jev-fast-playwright` MCP tools** — never Antigravity's built-in playwright
3. **Browser must be visibly open** — headless not acceptable
4. **Edge requires `--user-data-dir` for CDP** — without it the debug port won't work
5. **User opens Edge manually** — agent cannot create visible windows in user's desktop session

---

## 🔄 Conversation Flow Summary

| Time | What Happened |
|------|--------------|
| 18:03 | User ran `/mcp` to list available MCP tools |
| 18:09 | User complained: nothing launched, no chrome opened |
| 18:39 | Agent investigated source code, found `PLAYWRIGHT_HEADLESS=true` bug |
| 19:xx | Fixed race condition mutex in browserManager, fixed headless flag, fixed transport order |
| 20:xx | Demoblaze demo ran successfully, screenshots captured but Chrome window not visible |
| 20:39 | Context checkpoint saved |
| 20:44 | Switched to Edge (channel: 'msedge') — demoblaze demo ran in 19.1s, visible on desktop |
| 20:47 | User asked to test Adidas instead |
| 21:02 | User opened Edge manually |
| 21:03 | User ran correct command with `--user-data-dir="C:\EdgeDebug2"` |
| 21:05 | CDP port 9222 confirmed live (Edge v154) |
| 21:06 | **Adidas automation ran successfully** — searched "running shoes", clicked size button |
| 21:34 | User requested this context.md file |
