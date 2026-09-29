# ⚡ jev-fast-playwright

<p align="center">
  <b>Ultra-low-latency, token-efficient browser UI testing MCP server for AI coding agents.</b><br>
  <i>System-2 plans the journey · System-1 sees the DOM · Playwright acts in real-time</i>
</p>

<p align="center">
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-Compatible-blue.svg?style=flat-square" alt="MCP"></a>
  <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-Automation-2EAD33.svg?style=flat-square" alt="Playwright"></a>
  <a href="https://typesafe.ai"><img src="https://img.shields.io/badge/Model-Jev_System--1-8A2BE2.svg?style=flat-square" alt="TypeSafe Jev"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License">
</p>

---

## 🎬 Live Demo

<!-- Autoplaying visual demo loop -->


https://github.com/user-attachments/assets/844a6cc3-e73e-4f7d-94f5-63d20f1fb432



<p align="center">
  <a href="demo/demo.mp4"><b>▶️ Watch Full 2-Minute Demo Video with Voiceover Narration (1080p, 5.4 MB)</b></a>
</p>

> **What's happening in the clip:** An AI agent executes an e-commerce search, navigates lazy-hydrated product grids, dismisses interstitial overlays, selects shoe sizes, and triggers cart actions—all with **under 350 tokens per step** and sub-second decision latencies.

---

## 💡 Why This vs Traditional Playwright Agents?

| Traditional Vision / Playwright Agent | `jev-fast-playwright` |
| :--- | :--- |
| ❌ Dumps massive raw HTML or raw 4K screenshots into LLM context | 🟢 Injects client-side **`compressDOM`** script (clean, minimal interactive JSON) |
| ❌ Burns **10,000 – 40,000 tokens** per action | 🟢 Uses **~300 tokens** per step with concise structured JSON |
| ❌ 5–15 second latency per click decision | 🟢 **150ms – 400ms** selection via TypeSafe Jev System-1 model |
| ❌ Fragile CSS/XPath selectors that break on minor DOM changes | 🟢 Dynamic semantic matching with resilient multi-tier click recovery |

```
┌───────────────────────────────────────┐
│     Planning Agent (System 2)        │  (Cursor, Claude Code, Antigravity)
│  "Search running shoes, open card"    │
└──────────────────┬────────────────────┘
                   │ MCP stdio (~300 tokens)
                   ▼
┌────────────────────────────────────────────────────────┐
│               jev-fast-playwright                      │
│  1. Injects compressDOM.js (stamps jev-id + zones)     │
│  2. Asks TypeSafe Jev System-1 API (or fast heuristic) │
│  3. Executes resilient click / type via Playwright    │
└──────────────────┬─────────────────────────────────────┘
                   ▼
┌───────────────────────────────────────┐
│           Live Chrome Window          │
│   (Click, type, scroll, hydrate)      │
└───────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Installation

```bash
git clone https://github.com/Adityakk9031/jev-fast-playwright.git
cd jev-fast-playwright
npm install
npm run build
```

### 2. Configuration (`.env`)

Copy `.env.example` to `.env` and configure:

```env
# TypeSafe Jev System-1 API Key (optional — offline heuristic fallback included)
JEV_API_KEY=your_typesafe_api_key_here

# Browser execution mode: 'launch' (opens visible Chrome) or 'attach' (CDP)
JEV_BROWSER_MODE=launch
PLAYWRIGHT_CHANNEL=chrome
PLAYWRIGHT_HEADLESS=false

# Dedicated debug profile (prevents interference with your daily browser)
JEV_USER_DATA_DIR=C:\ChromeDebugJev

# Auto-click confidence gate (0.0 to 1.0)
JEV_CONFIDENCE_THRESHOLD=0.75
```

### 3. Run Standalone Demo

```bash
npm run demo
```
*Launches Chrome, opens Demoblaze, compresses the DOM, and clicks "Laptops" at 0.84 confidence in under 8.5 seconds.*

---

## 🔌 Connecting to Your Agent

### Cursor (`~/.cursor/mcp.json`)

Add the following to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "jev-fast-playwright": {
      "command": "node",
      "args": ["d:/jev_bridge/build/src/index.js"],
      "env": {
        "JEV_API_KEY": "your_typesafe_api_key_here",
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

### Google Antigravity (`~/.gemini/antigravity/mcp_config.json`)

```json
{
  "mcpServers": {
    "jev-fast-playwright": {
      "command": "node",
      "args": ["d:/jev_bridge/build/src/index.js"],
      "env": {
        "JEV_API_KEY": "your_typesafe_api_key_here",
        "PLAYWRIGHT_CHANNEL": "chrome",
        "PLAYWRIGHT_HEADLESS": "false"
      }
    }
  }
}
```

---

## 🛠️ MCP Tools Reference

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`jev_navigate`** | `url: string` | Navigates the browser, handles SPA readiness, and returns page title and status. |
| **`jev_fast_click`** | `target_description: string`<br>`navigate_to?: string` | Semantic click: compresses DOM, queries Jev model, verifies confidence, and clicks element. |
| **`jev_type`** | `target_description: string`<br>`text: string`<br>`clear_first?: boolean` | Locates targeted input or textbox semantically and types characters. |
| **`jev_page_snapshot`** | *none* | Audits page state: returns compressed list of visible interactive elements with labels and zones. |
| **`jev_press_key`** | `key: string` | Sends keyboard events (`Enter`, `Escape`, `Tab`, `ArrowDown`). |
| **`jev_scroll`** | `direction: 'up'\|'down'\|'top'\|'bottom'`<br>`amount_px?: number` | Scrolls viewport to trigger lazy loading and reveal below-the-fold content. |
| **`jev_wait`** | `timeout_ms?: number`<br>`url_includes?: string` | Pauses execution or waits for target URL changes. |
| **`jev_screenshot`** | `full_page?: boolean` | Captures visual screenshot (returns base64 PNG; use sparingly to save tokens). |
| **`jev_browser_status`**| *none* | Health check: reports connection status, active URL, and browser mode. |

---

## 🧠 Decision Engine & Resilience

### 1. Dual Selection Engine
* **TypeSafe System-1 API**: Primary intelligence via `https://api.typesafe.ai/v1/systemone` (`jev-latest`), returning `choice` and calibrated `confidence`.
* **Local Heuristic Fallback**: Automatic offline failover. Evaluates elements using distinctiveness-weighted token frequency, zone priors (header vs. main vs. footer), negation exclusions (`"not the nav shoes"`), and query-echo penalties.

### 2. Multi-Tier Click Recovery Ladder
When clicks fail due to modern web dynamic overlays (cookie banners, sticky headers, promotional modals):
1. **Direct Click**: Standard Playwright pointer event with hit-testing.
2. **Overlay Neutralization**: Auto-dismissal ladder (presses `Escape`, clicks common dismiss targets like `"Accept"`, `"Close"`).
3. **Programmatic Dispatch**: Falls back to `element.click()` via JavaScript DOM dispatch (bypasses pointer interception).
4. **Forced Pointer**: Low-level mouse event dispatch.

---

## 🧪 Testing & Verification

```bash
# Pure heuristic unit tests (no browser required, ~2 seconds)
npm run test:heuristic

# Real MCP end-to-end e-commerce flow (opens Chrome, searches Adidas, clicks Adizero product)
npm run test:adidas

# Interactive Demoblaze regression test
npm run demo

# Clean re-transpilation with SWC (super-fast, ~200ms)
npm run build
```

---

## 📂 Project Structure

```
jev-fast-playwright/
├── src/
│   ├── index.ts              # MCP Server implementation & tool handlers
│   ├── browserManager.ts     # Persistent Playwright browser instance
│   ├── jevClient.ts          # TypeSafe API integration + heuristic engine
│   └── utils/
│       ├── compressDOM.ts    # Injected DOM compression & zone tagger
│       └── logger.ts         # Zero-pollution stderr JSON logger
├── demo/
│   ├── demo_preview.gif      # Autoplaying README demo preview
│   ├── demo.mp4              # Full 2-minute master video with audio
│   └── run_demo.ts           # Standalone demonstration script
├── test/
│   ├── heuristicTest.ts      # 8 pinned heuristic selection test cases
│   └── adidas_mcp_test.ts    # Live E2E shopping workflow test
└── artifacts/                # Benchmark outputs & reports
```

---

## 📄 License

MIT © [Adityakk9031](https://github.com/Adityakk9031)
