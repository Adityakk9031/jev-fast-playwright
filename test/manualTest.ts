/**
 * test/manualTest.ts
 *
 * A standalone integration test that exercises each MCP tool directly,
 * WITHOUT needing Antigravity or a real Jev API key.
 *
 * Tests that DON'T need Jev API:
 *   ✅ jev_navigate
 *   ✅ jev_page_snapshot
 *   ✅ jev_screenshot
 *
 * Tests that NEED a real Jev API key:
 *   ⚙️  jev_fast_click
 *   ⚙️  jev_type
 *
 * Run:
 *   npx ts-node --transpile-only test/manualTest.ts
 */

import 'dotenv/config';
import { BrowserManager } from '../src/browserManager';
import { getCompressDOMScript } from '../src/utils/compressDOM';
import { logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const TEST_URL = 'https://example.com';
const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️ ';

let passed = 0;
let failed = 0;

function result(name: string, ok: boolean, detail?: string) {
  const icon = ok ? PASS : FAIL;
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  jev-antigravity-bridge  ·  Manual Test Suite');
  console.log('══════════════════════════════════════════════\n');

  BrowserManager.resetInstance();
  const bm = BrowserManager.getInstance({
    browserType: 'chromium',
    headless: true,
    mode: 'launch',
    channel: 'chromium',
    launchTimeoutMs: 30_000,
    actionTimeoutMs: 10_000,
  });

  // ── Test 1: Browser launch ────────────────────────────────────────────────
  try {
    await bm.init();
    result('Browser launch', bm.isReady, 'Chromium launched in headless mode');
  } catch (e) {
    result('Browser launch', false, String(e));
    console.log('\nFATAL: Cannot launch browser. Run: npx playwright install chromium\n');
    process.exit(1);
  }

  // ── Test 2: Navigation ────────────────────────────────────────────────────
  try {
    const t = Date.now();
    const page = await bm.navigateTo(TEST_URL);
    const elapsed = Date.now() - t;
    const url = page.url();
    const ok = url.includes('example.com');
    result('jev_navigate', ok, `url=${url}  (${elapsed}ms)`);
  } catch (e) {
    result('jev_navigate', false, String(e));
  }

  // ── Test 3: compressDOM injection ─────────────────────────────────────────
  try {
    const page = await bm.getPage();
    const script = getCompressDOMScript();
    const t = Date.now();
    const raw = await page.evaluate(script) as string;
    const elapsed = Date.now() - t;
    const elements = JSON.parse(raw) as unknown[];
    const ok = Array.isArray(elements);
    result(
      'compressDOM injection',
      ok,
      `found ${elements.length} interactive element(s) in ${elapsed}ms`,
    );
    if (ok && elements.length > 0) {
      console.log('   Sample elements:');
      elements.slice(0, 3).forEach((el) => {
        console.log('  ', JSON.stringify(el));
      });
    }
  } catch (e) {
    result('compressDOM injection', false, String(e));
  }

  // ── Test 4: jev_page_snapshot (navigate to a richer page) ─────────────────
  try {
    await bm.navigateTo('https://www.wikipedia.org');
    const page = await bm.getPage();
    const script = getCompressDOMScript();
    const raw = await page.evaluate(script) as string;
    const elements = JSON.parse(raw) as unknown[];
    const ok = elements.length > 5; // Wikipedia has lots of links/inputs
    result(
      'jev_page_snapshot (wikipedia.org)',
      ok,
      `found ${elements.length} interactive element(s)`,
    );
  } catch (e) {
    result('jev_page_snapshot (wikipedia.org)', false, String(e));
  }

  // ── Test 5: jev_screenshot ────────────────────────────────────────────────
  try {
    const page = await bm.getPage();
    const buffer = await page.screenshot({ fullPage: false, type: 'png' });
    const b64 = buffer.toString('base64');
    const ok = b64.length > 1000; // valid PNG is always large
    const outPath = path.join(__dirname, 'screenshot_test.png');
    fs.writeFileSync(outPath, buffer);
    result('jev_screenshot', ok, `${(buffer.length / 1024).toFixed(1)} KB → saved to test/screenshot_test.png`);
  } catch (e) {
    result('jev_screenshot', false, String(e));
  }

  // ── Test 6: Jev API (skipped if no real key) ──────────────────────────────
  const apiKey = process.env['JEV_API_KEY'];
  const hasRealKey = apiKey && !apiKey.startsWith('test') && apiKey.length > 20;

  if (!hasRealKey) {
    console.log(`${SKIP} jev_fast_click — skipped (set a real JEV_API_KEY in .env to test)`);
    console.log(`${SKIP} jev_type       — skipped (set a real JEV_API_KEY in .env to test)`);
  } else {
    // Only run if a real key is present
    const { JevClient } = await import('../src/jevClient');
    const jevClient = new JevClient({ apiKey, timeoutMs: 10_000 });

    try {
      // Navigate to a page with known interactive elements
      await bm.navigateTo('https://www.google.com');
      const page = await bm.getPage();
      const script = getCompressDOMScript();
      const raw = await page.evaluate(script) as string;
      const elements = JSON.parse(raw);

      const t = Date.now();
      const resp = await jevClient.selectElement(elements, 'the search input field');
      const elapsed = Date.now() - t;

      const ok = typeof resp.target_id.choice === 'string' && resp.target_id.confidence > 0;
      result(
        'Jev API — selectElement (Google search box)',
        ok,
        `choice=${resp.target_id.choice}  confidence=${(resp.target_id.confidence * 100).toFixed(1)}%  latency=${elapsed}ms`,
      );
    } catch (e) {
      result('Jev API — selectElement', false, String(e));
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  await bm.shutdown();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('──────────────────────────────────────────────\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error('Test runner crashed', { err: String(err) });
  process.exit(1);
});
