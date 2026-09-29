/**
 * index.ts — jev-antigravity-bridge MCP Server
 *
 * Entry point. Wires together:
 *   • @modelcontextprotocol/sdk  →  MCP protocol + StdioServerTransport
 *   • BrowserManager             →  persistent Playwright browser/page (CDP attach preferred)
 *   • JevClient                  →  fast System-1 element selection (+ labeled heuristic)
 *   • compressDOM                →  minimal, schema-locked DOM serialiser
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env reliably regardless of current working directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// zod/v4: the MCP SDK (1.30+) validates tool schemas with zod v4 types.
import { z } from 'zod/v4';
import type { Page } from 'playwright';

import { BrowserManager, type BrowserChannel, type BrowserMode } from './browserManager';
import { JevClient, type JevResponse } from './jevClient';
import { getCompressDOMScript, type CompressedElement } from './utils/compressDOM';
import { logger } from './utils/logger';

// ─── Environment ─────────────────────────────────────────────────────────────

const JEV_API_KEY = process.env['JEV_API_KEY'] ?? process.env['TYPESAFE_API_KEY'];
if (!JEV_API_KEY) {
  process.stderr.write(
    '[jev-bridge] FATAL: JEV_API_KEY (or TYPESAFE_API_KEY) environment variable is not set.\n' +
    '[jev-bridge] Copy .env.example to .env and add your TypeSafe key (console.typesafe.ai/keys).\n',
  );
  process.exit(1);
}

const CONFIDENCE_THRESHOLD = parseFloat(process.env['JEV_CONFIDENCE_THRESHOLD'] ?? '0.75');
const PLAYWRIGHT_BROWSER_TYPE = (process.env['PLAYWRIGHT_BROWSER_TYPE'] ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';
const PLAYWRIGHT_HEADLESS      = process.env['PLAYWRIGHT_HEADLESS'] === 'true';
const PLAYWRIGHT_LAUNCH_TIMEOUT = parseInt(process.env['PLAYWRIGHT_LAUNCH_TIMEOUT'] ?? '30000', 10);
const PLAYWRIGHT_ACTION_TIMEOUT = parseInt(process.env['PLAYWRIGHT_ACTION_TIMEOUT'] ?? '10000', 10);

const modeEnv = (process.env['JEV_BROWSER_MODE'] ?? 'launch').toLowerCase();
const JEV_BROWSER_MODE: BrowserMode =
  modeEnv === 'attach' || modeEnv === 'launch' || modeEnv === 'auto' ? modeEnv : 'launch';

const channelEnv = (process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome').toLowerCase();
const PLAYWRIGHT_CHANNEL: BrowserChannel =
  channelEnv === 'chrome' || channelEnv === 'msedge' || channelEnv === 'chromium'
    ? channelEnv
    : 'chrome';

const JEV_CDP_URL = process.env['JEV_CDP_URL'] ?? 'http://127.0.0.1:9222';
const JEV_USER_DATA_DIR = process.env['JEV_USER_DATA_DIR'] ?? 'C:\\ChromeDebugJev';

// ─── Singletons ──────────────────────────────────────────────────────────────

const browserManager = BrowserManager.getInstance({
  browserType:     PLAYWRIGHT_BROWSER_TYPE,
  headless:        PLAYWRIGHT_HEADLESS,
  launchTimeoutMs: PLAYWRIGHT_LAUNCH_TIMEOUT,
  actionTimeoutMs: PLAYWRIGHT_ACTION_TIMEOUT,
  mode:            JEV_BROWSER_MODE,
  channel:         PLAYWRIGHT_CHANNEL,
  cdpUrl:          JEV_CDP_URL,
  userDataDir:     JEV_USER_DATA_DIR,
});

const jevClient = new JevClient({
  apiKey:   JEV_API_KEY,
  baseUrl:  process.env['JEV_API_BASE_URL'],
  model:    process.env['JEV_MODEL'],
  timeoutMs: PLAYWRIGHT_ACTION_TIMEOUT,
});

const COMPRESS_DOM_SCRIPT = getCompressDOMScript();

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name:    'jev-fast-playwright',
  version: '1.1.0',
});

function now(): number {
  return performance.now();
}

function ms(n: number): string {
  return `${n.toFixed(2)}ms`;
}

function jsonResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function attachHint(): string {
  if (JEV_BROWSER_MODE === 'launch') {
    return 'Launch mode: Chrome should open automatically on first tool call. If it fails, install Chrome or set PLAYWRIGHT_CHANNEL=chromium.';
  }
  return (
    `Open a visible browser first: run d:\\jev_bridge\\launch_edge.bat ` +
    `(requires --user-data-dir). Then confirm ${JEV_CDP_URL}/json/version returns JSON.`
  );
}

async function compressPage(page: Page): Promise<{ elements: CompressedElement[]; domLatency: number }> {
  const tDomStart = now();
  await page.waitForTimeout(400);
  const rawJson = await page.evaluate(COMPRESS_DOM_SCRIPT) as string;
  const elements = JSON.parse(rawJson) as CompressedElement[];
  return { elements, domLatency: now() - tDomStart };
}

/**
 * Compress once, and if the predicate says the page isn't ready yet (SPA still
 * hydrating), wait briefly and recompress once. Keeps tools fast on static
 * pages while avoiding spurious "no elements found" on slow ones.
 */
async function compressPageSettled(
  page: Page,
  isReady: (elements: CompressedElement[]) => boolean = () => true,
): Promise<{ elements: CompressedElement[]; domLatency: number }> {
  let result = await compressPage(page);
  if (!isReady(result.elements)) {
    await page.waitForTimeout(1200);
    result = await compressPage(page);
  }
  return result;
}

async function clickByJevId(page: Page, chosenId: string, opts?: { timeoutMs?: number }): Promise<void> {
  const timeout = opts?.timeoutMs ?? PLAYWRIGHT_ACTION_TIMEOUT;
  const locator = page.locator(`[jev-id="${chosenId}"]`);
  await locator.waitFor({ state: 'attached', timeout });
  await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await locator.waitFor({ state: 'visible', timeout });
  await locator.click({ timeout });
  await page.waitForTimeout(800);
}

/**
 * Programmatic click that bypasses hit-testing — reaches elements covered by
 * overlays (cookie banners, promo layers) as long as the element itself is
 * still in the DOM and its own handler drives the behaviour.
 */
async function jsClickByJevId(page: Page, chosenId: string): Promise<void> {
  await page.evaluate((id: string) => {
    const el = document.querySelector(`[jev-id="${id}"]`) as HTMLElement | null;
    if (!el) throw new Error(`js-click: [jev-id="${id}"] not found in DOM`);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, chosenId);
  await page.waitForTimeout(800);
}

/** Generic (non site-specific) dismissal of cookie banners / promo overlays. */
const DISMISS_OVERLAY_SCRIPT = `(function dismissOverlays() {
  var RE = /^(accept|accept all|i accept|agree|i agree|allow|allow all|got it|ok|okay|i understand|close|no thanks|no, thanks|not now|dismiss)$/i;
  var nodes = document.querySelectorAll('button, [role="button"], a');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').trim();
    if (!RE.test(t)) continue;
    var r = el.getBoundingClientRect();
    var s = window.getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
    el.click();
    return t;
  }
  return null;
})()`;

async function dismissOverlays(page: Page): Promise<string | null> {
  await page.keyboard.press('Escape').catch(() => {});
  const dismissed = await page.evaluate(DISMISS_OVERLAY_SCRIPT) as string | null;
  if (dismissed) await page.waitForTimeout(600);
  return dismissed;
}

const STALE_ELEMENT_RE = /detached|stale|not found|no such element|not attached|removed from the dom/i;

interface ClickOutcome { strategy: string; dismissedOverlay: string | null; }

/**
 * Click with recovery ladder: direct → dismiss overlay + retry → programmatic
 * js-click → force click. Stale-element errors are rethrown so the caller can
 * recompress and reselect instead.
 */
async function performClick(page: Page, chosenId: string): Promise<ClickOutcome> {
  try {
    await clickByJevId(page, chosenId, { timeoutMs: Math.min(4000, PLAYWRIGHT_ACTION_TIMEOUT) });
    return { strategy: 'direct', dismissedOverlay: null };
  } catch (firstErr) {
    if (STALE_ELEMENT_RE.test(String(firstErr))) throw firstErr;

    const dismissedOverlay = await dismissOverlays(page).catch(() => null);
    try {
      await clickByJevId(page, chosenId, { timeoutMs: Math.min(6000, PLAYWRIGHT_ACTION_TIMEOUT) });
      return { strategy: dismissedOverlay ? 'direct-after-overlay-dismiss' : 'direct-retry', dismissedOverlay };
    } catch {
      try {
        await jsClickByJevId(page, chosenId);
        return { strategy: 'js-click', dismissedOverlay };
      } catch {
        const locator = page.locator(`[jev-id="${chosenId}"]`);
        await locator.click({ force: true, timeout: Math.min(6000, PLAYWRIGHT_ACTION_TIMEOUT) });
        await page.waitForTimeout(800);
        return { strategy: 'force-click', dismissedOverlay };
      }
    }
  }
}

async function selectAndAct(
  targetDescription: string,
  elements: CompressedElement[],
): Promise<{ jevResponse: JevResponse; jevLatency: number; chosenElement: CompressedElement }> {
  const tJevStart = now();
  const jevResponse = await jevClient.selectElement(elements, targetDescription);
  const jevLatency = now() - tJevStart;
  const { choice: chosenId } = jevResponse.target_id;
  const chosenElement = elements.find(e => e.id === chosenId);
  if (!chosenElement) {
    throw Object.assign(new Error(`INVALID_JEV_CHOICE:${chosenId}`), { code: 'INVALID_JEV_CHOICE' });
  }
  return { jevResponse, jevLatency, chosenElement };
}

// ─── Tool: jev_browser_status ────────────────────────────────────────────────

server.tool(
  'jev_browser_status',
  'Check whether the browser is connected (CDP attach or launched), current URL, and CDP reachability. ' +
    'Call this first when automation seems stuck or Edge is not visible.',
  {},
  async () => {
    try {
      const status = await browserManager.getStatus();
      return jsonResult({
        success: true,
        ...status,
        hint: status.ready
          ? 'Browser ready.'
          : status.cdpReachable
            ? 'CDP is up but not yet attached — call jev_navigate to connect.'
            : attachHint(),
      });
    } catch (err) {
      return jsonResult({ success: false, reason: 'STATUS_FAILED', message: String(err) }, true);
    }
  },
);

// ─── Tool: jev_fast_click ────────────────────────────────────────────────────

server.tool(
  'jev_fast_click',
  'Instantly find and click a specific element on the current browser page ' +
    'by describing it in natural language (e.g. "the main checkout button", ' +
    '"Accept cookies"). Uses Jev System-1 AI (or a labeled heuristic fallback).',
  {
    target_description: z
      .string()
      .min(3)
      .max(500)
      .describe(
        'Natural-language description of the element to click. ' +
        'Be specific: include visible text, role, or purpose.',
      ),
    navigate_to: z
      .string()
      .url()
      .optional()
      .describe('Optional URL to navigate to before clicking.'),
  },
  async ({ target_description, navigate_to }) => {
    const tTotal = now();
    logger.info('jev_fast_click invoked', { target: target_description, navigate_to });

    try {
      const page = await browserManager.getPage();

      if (navigate_to) {
        await browserManager.navigateTo(navigate_to);
      }

      const currentUrl = page.url();
      if (!currentUrl || currentUrl === 'about:blank') {
        return jsonResult({
          success: false,
          reason:  'NO_PAGE_LOADED',
          message: 'No active page. Provide navigate_to or call jev_navigate first.',
          hint: attachHint(),
        }, true);
      }

      let { elements, domLatency } = await compressPageSettled(page, els => els.length > 0);

      if (elements.length === 0) {
        return jsonResult({
          success: false,
          reason:  'NO_INTERACTIVE_ELEMENTS',
          message: 'No visible interactive elements found.',
          url: currentUrl,
        }, true);
      }

      const { jevResponse, jevLatency } = await selectAndAct(target_description, elements);
      let { choice: chosenId, confidence } = jevResponse.target_id;
      let selectorSource = jevResponse.source;
      let chosenElement = elements.find(e => e.id === chosenId)!;

      logger.info('Element selected', { chosenId, confidence, source: selectorSource, latency: ms(jevLatency) });

      if (confidence < CONFIDENCE_THRESHOLD) {
        return jsonResult({
          success: false,
          reason: 'LOW_CONFIDENCE',
          message:
            `Matched "${chosenElement.text ?? chosenElement.ariaLabel ?? chosenId}" ` +
            `with ${(confidence * 100).toFixed(1)}% confidence (source=${selectorSource}) — ` +
            `below ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}% threshold. Click NOT executed.`,
          jev_choice: chosenId,
          confidence,
          threshold: CONFIDENCE_THRESHOLD,
          selector_source: selectorSource,
          candidate: chosenElement,
          all_candidates: elements.slice(0, 12),
          hint: 'Retry with the exact visible text of the target, or inspect jev_page_snapshot and describe that element more specifically (avoid "not X" phrasing).',
          metrics: {
            dom_compression_ms: parseFloat(domLatency.toFixed(2)),
            jev_api_ms: parseFloat(jevLatency.toFixed(2)),
            total_ms: parseFloat((now() - tTotal).toFixed(2)),
          },
        });
      }

      const tClickStart = now();
      let clickOutcome: ClickOutcome;
      try {
        clickOutcome = await performClick(page, chosenId);
      } catch (clickErr) {
        logger.warn('Click failed — recompressing and retrying once', { err: String(clickErr) });
        const retry = await compressPage(page);
        elements = retry.elements;
        domLatency += retry.domLatency;
        const retrySelect = await selectAndAct(target_description, elements);
        if (retrySelect.jevResponse.target_id.confidence < CONFIDENCE_THRESHOLD) {
          return jsonResult({
            success: false,
            reason: 'CLICK_FAILED',
            message: `Click failed and retry was low-confidence: ${String(clickErr)}`,
            selector_source: retrySelect.jevResponse.source,
            first_error: String(clickErr),
          }, true);
        }
        try {
          clickOutcome = await performClick(page, retrySelect.jevResponse.target_id.choice);
          chosenId = retrySelect.jevResponse.target_id.choice;
          confidence = retrySelect.jevResponse.target_id.confidence;
          selectorSource = retrySelect.jevResponse.source;
          chosenElement = retrySelect.chosenElement;
        } catch (retryErr) {
          return jsonResult({
            success: false,
            reason: 'CLICK_FAILED',
            message: `Playwright could not click: ${String(retryErr)}`,
            selector_source: retrySelect.jevResponse.source,
            jev_choice: retrySelect.jevResponse.target_id.choice,
            confidence: retrySelect.jevResponse.target_id.confidence,
            chosen_element: retrySelect.chosenElement,
          }, true);
        }
      }
      const clickLatency = now() - tClickStart;

      return jsonResult({
        success: true,
        message:
          `Clicked "${chosenElement.text ?? chosenElement.ariaLabel ?? chosenElement.tag}" ` +
          `[jev-id="${chosenId}"] with ${(confidence * 100).toFixed(1)}% confidence ` +
          `(source=${selectorSource}, strategy=${clickOutcome.strategy}).`,
        clicked_element: chosenElement,
        confidence,
        selector_source: selectorSource,
        click_strategy: clickOutcome.strategy,
        dismissed_overlay: clickOutcome.dismissedOverlay,
        browser_mode: browserManager.mode,
        connection: browserManager.connectionType,
        url: page.url(),
        metrics: {
          dom_compression_ms: parseFloat(domLatency.toFixed(2)),
          jev_api_ms: parseFloat(jevLatency.toFixed(2)),
          click_ms: parseFloat(clickLatency.toFixed(2)),
          total_ms: parseFloat((now() - tTotal).toFixed(2)),
        },
      });
    } catch (err) {
      const msg = String(err);
      logger.error('jev_fast_click: unexpected error', { err: msg });
      const isAttach = msg.includes('CDP attach failed');
      return jsonResult({
        success: false,
        reason: isAttach ? 'BROWSER_NOT_ATTACHED' : 'UNEXPECTED_ERROR',
        message: msg,
        hint: isAttach ? attachHint() : undefined,
      }, true);
    }
  },
);

// ─── Tool: jev_navigate ──────────────────────────────────────────────────────

server.tool(
  'jev_navigate',
  'Navigate the shared Playwright browser to a URL. ' +
    'In attach mode, Edge must already be open via launch_edge.bat.',
  {
    url: z.string().url().describe('Fully-qualified URL including protocol (https://).'),
    wait_until: z
      .enum(['domcontentloaded', 'load', 'networkidle', 'commit'])
      .optional()
      .default('domcontentloaded')
      .describe('Playwright waitUntil event. Defaults to domcontentloaded for speed.'),
  },
  async ({ url, wait_until }) => {
    logger.info('jev_navigate invoked', { url, wait_until });
    const t = now();

    try {
      const page = await browserManager.getPage();
      await page.goto(url, { waitUntil: wait_until as 'domcontentloaded', timeout: PLAYWRIGHT_LAUNCH_TIMEOUT });
      await page.waitForTimeout(1000);
      const elapsed = now() - t;

      return jsonResult({
        success: true,
        message: `Navigated to ${url}`,
        final_url: page.url(),
        title: await page.title(),
        browser_mode: browserManager.mode,
        connection: browserManager.connectionType,
        elapsed_ms: parseFloat(elapsed.toFixed(2)),
      });
    } catch (err) {
      const msg = String(err);
      logger.error('jev_navigate failed', { url, err: msg });
      const isAttach = msg.includes('CDP attach failed');
      return jsonResult({
        success: false,
        reason: isAttach ? 'BROWSER_NOT_ATTACHED' : 'NAVIGATION_FAILED',
        message: `Navigation to ${url} failed: ${msg}`,
        hint: isAttach ? attachHint() : undefined,
      }, true);
    }
  },
);

// ─── Tool: jev_page_snapshot ─────────────────────────────────────────────────

server.tool(
  'jev_page_snapshot',
  'Returns a compressed JSON snapshot of all visible interactive elements on the current page.',
  {
    include_text_nodes: z
      .boolean()
      .optional()
      .default(false)
      .describe('Reserved; currently ignored. Interactive elements only.'),
  },
  async () => {
    logger.info('jev_page_snapshot invoked');
    const t = now();

    try {
      const page = await browserManager.getPage();
      const url = page.url();

      if (!url || url === 'about:blank') {
        return jsonResult({
          success: false,
          reason: 'NO_PAGE_LOADED',
          message: 'No page loaded. Use jev_navigate first.',
          hint: attachHint(),
        }, true);
      }

      const { elements, domLatency } = await compressPage(page);
      return jsonResult({
        success: true,
        url,
        title: await page.title(),
        element_count: elements.length,
        elements,
        elapsed_ms: parseFloat((now() - t).toFixed(2)),
        dom_compression_ms: parseFloat(domLatency.toFixed(2)),
      });
    } catch (err) {
      const msg = String(err);
      const isAttach = msg.includes('CDP attach failed');
      return jsonResult({
        success: false,
        reason: isAttach ? 'BROWSER_NOT_ATTACHED' : 'SNAPSHOT_FAILED',
        message: msg,
        hint: isAttach ? attachHint() : undefined,
      }, true);
    }
  },
);

// ─── Tool: jev_type ──────────────────────────────────────────────────────────

server.tool(
  'jev_type',
  'Locate an input field by natural-language description and type text into it.',
  {
    target_description: z.string().min(3).max(500).describe('Description of the input field.'),
    text: z.string().describe('Text to type.'),
    clear_first: z.boolean().optional().default(true).describe('Clear existing value first.'),
    navigate_to: z.string().url().optional().describe('Optional URL before typing.'),
  },
  async ({ target_description, text, clear_first, navigate_to }) => {
    const tTotal = now();
    logger.info('jev_type invoked', { target: target_description });

    try {
      const page = await browserManager.getPage();
      if (navigate_to) await browserManager.navigateTo(navigate_to);

      const isInputElement = (e: CompressedElement) =>
        ['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(e.role) ||
        ['INPUT', 'TEXTAREA'].includes(e.tag);
      const { elements, domLatency } = await compressPageSettled(page, els => els.some(isInputElement));
      const inputElements = elements.filter(isInputElement);

      if (inputElements.length === 0) {
        return jsonResult({
          success: false,
          reason: 'NO_INPUT_ELEMENTS',
          message: 'No input elements found on page.',
        }, true);
      }

      const { jevResponse, jevLatency, chosenElement } = await selectAndAct(target_description, inputElements);
      const { choice: chosenId, confidence } = jevResponse.target_id;

      if (confidence < CONFIDENCE_THRESHOLD) {
        return jsonResult({
          success: false,
          reason: 'LOW_CONFIDENCE',
          confidence,
          threshold: CONFIDENCE_THRESHOLD,
          selector_source: jevResponse.source,
          message: `Low confidence (${(confidence * 100).toFixed(1)}%). Type NOT executed.`,
        });
      }

      const locator = page.locator(`[jev-id="${chosenId}"]`);
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.waitFor({ state: 'visible', timeout: PLAYWRIGHT_ACTION_TIMEOUT });
      if (clear_first) await locator.fill('');
      await locator.type(text, { delay: 25 });

      return jsonResult({
        success: true,
        message: `Typed into ${chosenElement.placeholder ?? chosenElement.name ?? chosenId}`,
        target_element: chosenElement,
        confidence,
        selector_source: jevResponse.source,
        metrics: {
          dom_compression_ms: parseFloat(domLatency.toFixed(2)),
          jev_api_ms: parseFloat(jevLatency.toFixed(2)),
          total_ms: parseFloat((now() - tTotal).toFixed(2)),
        },
      });
    } catch (err) {
      const msg = String(err);
      const isAttach = msg.includes('CDP attach failed');
      return jsonResult({
        success: false,
        reason: isAttach ? 'BROWSER_NOT_ATTACHED' : 'UNEXPECTED_ERROR',
        message: msg,
        hint: isAttach ? attachHint() : undefined,
      }, true);
    }
  },
);

// ─── Tool: jev_scroll ────────────────────────────────────────────────────────

server.tool(
  'jev_scroll',
  'Scroll the current page so off-screen elements become clickable.',
  {
    direction: z.enum(['down', 'up', 'top', 'bottom']).default('down').describe('Scroll direction.'),
    amount_px: z.number().int().min(50).max(5000).optional().default(800).describe('Pixels for up/down.'),
  },
  async ({ direction, amount_px }) => {
    try {
      const page = await browserManager.getPage();
      if (direction === 'top') {
        await page.evaluate(() => window.scrollTo(0, 0));
      } else if (direction === 'bottom') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } else {
        const delta = direction === 'down' ? amount_px : -amount_px;
        await page.mouse.wheel(0, delta);
      }
      await page.waitForTimeout(400);
      return jsonResult({
        success: true,
        direction,
        amount_px,
        url: page.url(),
        scroll_y: await page.evaluate(() => window.scrollY),
      });
    } catch (err) {
      return jsonResult({ success: false, reason: 'SCROLL_FAILED', message: String(err) }, true);
    }
  },
);

// ─── Tool: jev_wait ──────────────────────────────────────────────────────────

server.tool(
  'jev_wait',
  'Wait for page text, URL substring, or a timeout before the next action.',
  {
    text: z.string().optional().describe('Wait until this text appears on the page.'),
    url_includes: z.string().optional().describe('Wait until the URL contains this substring.'),
    timeout_ms: z.number().int().min(100).max(60000).optional().default(10000),
  },
  async ({ text, url_includes, timeout_ms }) => {
    try {
      const page = await browserManager.getPage();
      const t = now();

      if (url_includes) {
        await page.waitForURL(u => u.toString().includes(url_includes), { timeout: timeout_ms });
      } else if (text) {
        await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: timeout_ms });
      } else {
        await page.waitForTimeout(timeout_ms);
      }

      return jsonResult({
        success: true,
        url: page.url(),
        waited_ms: parseFloat((now() - t).toFixed(2)),
      });
    } catch (err) {
      return jsonResult({ success: false, reason: 'WAIT_TIMEOUT', message: String(err) }, true);
    }
  },
);

// ─── Tool: jev_press_key ─────────────────────────────────────────────────────

server.tool(
  'jev_press_key',
  'Press a keyboard key (Enter, Escape, Tab, ArrowDown, etc.) on the focused page.',
  {
    key: z.string().min(1).max(40).describe('Playwright key name, e.g. Enter, Escape, Tab, Control+A.'),
  },
  async ({ key }) => {
    try {
      const page = await browserManager.getPage();
      await page.keyboard.press(key);
      await page.waitForTimeout(300);
      return jsonResult({ success: true, key, url: page.url() });
    } catch (err) {
      return jsonResult({ success: false, reason: 'KEY_FAILED', message: String(err) }, true);
    }
  },
);

// ─── Tool: jev_screenshot ────────────────────────────────────────────────────

server.tool(
  'jev_screenshot',
  'Capture a screenshot of the current browser page as a base64 PNG.',
  {
    full_page: z.boolean().optional().default(false).describe('Full scrollable page vs viewport.'),
  },
  async ({ full_page }) => {
    logger.info('jev_screenshot invoked', { full_page });

    try {
      const page = await browserManager.getPage();
      await page.waitForTimeout(400);
      const buffer = await page.screenshot({ fullPage: full_page, type: 'png' });
      const b64 = buffer.toString('base64');

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              url: page.url(),
              title: await page.title(),
              format: 'png',
              encoding: 'base64',
              connection: browserManager.connectionType,
            }),
          },
          {
            type: 'image' as const,
            data: b64,
            mimeType: 'image/png',
          },
        ],
      };
    } catch (err) {
      const msg = String(err);
      const isAttach = msg.includes('CDP attach failed');
      return jsonResult({
        success: false,
        reason: isAttach ? 'BROWSER_NOT_ATTACHED' : 'SCREENSHOT_FAILED',
        message: msg,
        hint: isAttach ? attachHint() : undefined,
      }, true);
    }
  },
);

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down`);
  await browserManager.shutdown();
  process.exit(0);
}

process.on('SIGINT',  () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: String(err), stack: err.stack });
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('jev-antigravity-bridge starting', {
    version: '1.1.0',
    browserType: PLAYWRIGHT_BROWSER_TYPE,
    channel: PLAYWRIGHT_CHANNEL,
    mode: JEV_BROWSER_MODE,
    headless: PLAYWRIGHT_HEADLESS,
    cdpUrl: JEV_CDP_URL,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server connected via stdio — ready for tool calls');

  // Browser is lazily initialized on the first tool call (via browserManager.getPage()).
}

main().catch((err: unknown) => {
  process.stderr.write(`[jev-bridge] FATAL startup error: ${String(err)}\n`);
  process.exit(1);
});
