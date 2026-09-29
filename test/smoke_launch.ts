/**
 * smoke_launch.ts — Launch Chrome (no CDP bat required) and click Demoblaze Laptops.
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { BrowserManager } from '../src/browserManager';
import { getCompressDOMScript } from '../src/utils/compressDOM';
import { JevClient } from '../src/jevClient';

async function main() {
  console.log('\n══ jev-bridge LAUNCH smoke (Chrome) ══\n');
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

  await bm.init();
  console.log('status', await bm.getStatus());

  await bm.navigateTo('https://www.demoblaze.com');
  const page = await bm.getPage();
  console.log('title', await page.title());

  const elements = JSON.parse(await page.evaluate(getCompressDOMScript()) as string);
  console.log('elements', elements.length);

  const client = new JevClient({ apiKey: process.env['JEV_API_KEY']!, timeoutMs: 8000 });
  const pick = await client.selectElement(elements, 'Laptops category link');
  console.log('pick', pick.source, pick.target_id);

  if (pick.target_id.confidence >= 0.75) {
    const loc = page.locator(`[jev-id="${pick.target_id.choice}"]`);
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    console.log('Click OK →', page.url());
  }

  // Keep browser open briefly so user can see it, then close.
  await page.waitForTimeout(2000);
  await bm.shutdown();
  console.log('\nPASS launch smoke\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
