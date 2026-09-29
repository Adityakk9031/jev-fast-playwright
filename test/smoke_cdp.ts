/**
 * smoke_cdp.ts — Quick health check for visible-Edge + CDP attach workflow.
 *
 * Usage:
 *   1. Run launch_edge.bat (opens visible Edge with --user-data-dir)
 *   2. npx ts-node --transpile-only test/smoke_cdp.ts
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { BrowserManager } from '../src/browserManager';
import { getCompressDOMScript } from '../src/utils/compressDOM';
import { JevClient } from '../src/jevClient';

async function main() {
  console.log('\n══ jev-bridge CDP smoke test ══\n');

  BrowserManager.resetInstance();
  const bm = BrowserManager.getInstance({
    browserType: 'chromium',
    headless: false,
    mode: 'attach',
    channel: 'msedge',
    cdpUrl: process.env['JEV_CDP_URL'] ?? 'http://127.0.0.1:9222',
    launchTimeoutMs: 30_000,
    actionTimeoutMs: 10_000,
  });

  const status0 = await bm.getStatus();
  console.log('CDP reachable:', status0.cdpReachable, '@', status0.cdpUrl);
  if (!status0.cdpReachable) {
    console.error('\nFAIL: Start Edge first → run d:\\jev_bridge\\launch_edge.bat\n');
    process.exit(1);
  }

  await bm.init();
  const page = await bm.getPage();
  console.log('Attached. Current URL:', page.url());

  console.log('Navigating to demoblaze.com ...');
  await bm.navigateTo('https://www.demoblaze.com');
  console.log('Title:', await page.title());

  const script = getCompressDOMScript();
  const raw = await page.evaluate(script) as string;
  const elements = JSON.parse(raw) as Array<{ id: string; text: string | null; role: string }>;
  console.log('Interactive elements:', elements.length);

  const apiKey = process.env['JEV_API_KEY'];
  if (!apiKey) {
    console.warn('SKIP click: JEV_API_KEY missing');
  } else {
    const client = new JevClient({ apiKey, timeoutMs: 8000 });
    const pick = await client.selectElement(elements as any, 'Phones category link');
    console.log('Selector:', pick.source, pick.target_id);

    if (pick.target_id.confidence >= 0.75) {
      const loc = page.locator(`[jev-id="${pick.target_id.choice}"]`);
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 10000 });
      await page.waitForTimeout(1000);
      console.log('Click OK →', page.url());
    } else {
      console.warn('SKIP click: low confidence', pick.target_id.confidence);
    }
  }

  await bm.shutdown();
  console.log('\nPASS: CDP attach + navigate (+ optional click) succeeded.\n');
}

main().catch((err) => {
  console.error('\nFAIL:', err);
  process.exit(1);
});
