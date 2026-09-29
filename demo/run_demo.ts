/**
 * demo/run_demo.ts
 *
 * Standalone low-token demo — same actions as MCP tools, no coding-agent required.
 * Proves: launch Chrome → navigate → NL click → compact JSON report.
 *
 *   npm run demo
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { BrowserManager } from '../src/browserManager';
import { JevClient } from '../src/jevClient';
import { getCompressDOMScript, type CompressedElement } from '../src/utils/compressDOM';

type StepResult = {
  step: string;
  ok: boolean;
  ms: number;
  detail?: Record<string, unknown>;
  error?: string;
};

const THRESHOLD = parseFloat(process.env['JEV_CONFIDENCE_THRESHOLD'] ?? '0.75');
const OUT = path.resolve(__dirname, '../artifacts/demo_report.json');

async function main() {
  const t0 = Date.now();
  const steps: StepResult[] = [];
  const apiKey = process.env['JEV_API_KEY'];
  if (!apiKey) throw new Error('JEV_API_KEY missing in .env');

  BrowserManager.resetInstance();
  const bm = BrowserManager.getInstance({
    browserType: 'chromium',
    headless: false,
    mode: 'launch',
    channel: 'chrome',
    userDataDir: process.env['JEV_USER_DATA_DIR'] ?? 'C:\\ChromeDebugJev',
    launchTimeoutMs: 45_000,
    actionTimeoutMs: 15_000,
  });
  const jev = new JevClient({ apiKey, timeoutMs: 8_000 });
  const script = getCompressDOMScript();

  // 1) status / launch
  {
    const t = Date.now();
    try {
      await bm.init();
      const status = await bm.getStatus();
      steps.push({
        step: 'jev_browser_status',
        ok: status.ready,
        ms: Date.now() - t,
        detail: {
          mode: status.mode,
          connection: status.connection,
          channel: status.channel,
          ready: status.ready,
        },
      });
    } catch (e) {
      steps.push({ step: 'jev_browser_status', ok: false, ms: Date.now() - t, error: String(e) });
      throw e;
    }
  }

  // 2) navigate
  {
    const t = Date.now();
    try {
      const page = await bm.navigateTo('https://www.demoblaze.com');
      steps.push({
        step: 'jev_navigate',
        ok: true,
        ms: Date.now() - t,
        detail: { url: page.url(), title: await page.title() },
      });
    } catch (e) {
      steps.push({ step: 'jev_navigate', ok: false, ms: Date.now() - t, error: String(e) });
      throw e;
    }
  }

  // 3) snapshot (compressed — low token)
  let elements: CompressedElement[] = [];
  {
    const t = Date.now();
    try {
      const page = await bm.getPage();
      elements = JSON.parse(await page.evaluate(script) as string);
      // Keep report tiny: count + top labels only
      steps.push({
        step: 'jev_page_snapshot',
        ok: elements.length > 0,
        ms: Date.now() - t,
        detail: {
          element_count: elements.length,
          sample: elements.slice(0, 8).map(e => ({ id: e.id, role: e.role, text: e.text })),
        },
      });
    } catch (e) {
      steps.push({ step: 'jev_page_snapshot', ok: false, ms: Date.now() - t, error: String(e) });
      throw e;
    }
  }

  // 4) fast click Laptops
  {
    const t = Date.now();
    try {
      const page = await bm.getPage();
      const pick = await jev.selectElement(elements, 'Laptops category link');
      const { choice, confidence } = pick.target_id;
      if (confidence < THRESHOLD) {
        steps.push({
          step: 'jev_fast_click',
          ok: false,
          ms: Date.now() - t,
          detail: { reason: 'LOW_CONFIDENCE', confidence, source: pick.source, choice },
        });
      } else {
        const loc = page.locator(`[jev-id="${choice}"]`);
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 10_000 });
        await page.waitForTimeout(1000);
        const chosen = elements.find(e => e.id === choice);
        steps.push({
          step: 'jev_fast_click',
          ok: true,
          ms: Date.now() - t,
          detail: {
            target: 'Laptops',
            clicked: chosen?.text ?? choice,
            confidence,
            selector_source: pick.source,
            url: page.url(),
          },
        });
      }
    } catch (e) {
      steps.push({ step: 'jev_fast_click', ok: false, ms: Date.now() - t, error: String(e) });
      throw e;
    }
  }

  await bm.shutdown();

  const report = {
    demo: 'jev-fast-playwright',
    goal: 'Low-token UI test via compressed DOM + System-1 select (not full Playwright agent / screenshots)',
    passed: steps.every(s => s.ok),
    total_ms: Date.now() - t0,
    steps,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // Print compact for agent consumption
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ passed: false, error: String(e) }));
  process.exit(1);
});
