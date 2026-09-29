/**
 * adidas_live.ts
 * Connects to the already-open Edge (port 9222) and runs Adidas automation.
 */
import { chromium } from 'playwright';
import * as path from 'path';

const ARTIFACTS = 'C:\\Users\\user\\.gemini\\antigravity\\brain\\fae4c6f5-1e70-400a-83e7-10347250e5cd';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function shot(page: any, name: string) {
  const p = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${name}.png`);
}

async function main() {
  console.log('\n🚀 CONNECTING TO YOUR EDGE WINDOW...');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const [context] = browser.contexts();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  page.on('dialog', async (d: any) => { console.log(`  [dialog] ${d.message()}`); await d.accept().catch(() => {}); });

  console.log('[✓] Connected! Watch your Edge window!\n');

  // STEP 1 — Navigate to Adidas
  console.log('[1] Going to adidas.com...');
  let t = Date.now();
  await page.goto('https://www.adidas.com/us', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  console.log(`[✓] Loaded in ${Date.now() - t}ms`);
  await shot(page, 'adidas_1_home');

  // STEP 2 — Search
  console.log('\n[2] Searching "running shoes"...');
  t = Date.now();
  try {
    const searchEl = page.locator('input[type="search"], [data-testid*="search"], [placeholder*="search" i], [aria-label*="search" i]').first();
    await searchEl.click({ timeout: 5000 });
    await sleep(400);
    await page.keyboard.type('running shoes', { delay: 80 });
    await page.keyboard.press('Enter');
    await sleep(4000);
    console.log(`[✓] Searched in ${Date.now() - t}ms`);
  } catch {
    console.log('  [fallback] direct URL');
    await page.goto('https://www.adidas.com/us/search?q=running+shoes', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    console.log('[✓] Search results loaded');
  }
  await shot(page, 'adidas_2_search');

  // STEP 3 — Click first product
  console.log('\n[3] Clicking first product...');
  t = Date.now();
  try {
    const card = page.locator('[data-testid="product-card"], .glass-product-card, article, .product-card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    const txt = await card.locator('p, h2, h3, span').first().textContent().catch(() => 'product');
    console.log(`  → "${txt?.trim().slice(0, 60)}"`);
    await card.click();
    await sleep(4000);
    console.log(`[✓] Product opened in ${Date.now() - t}ms`);
  } catch (e) {
    console.log('  [skip]', String(e).slice(0, 80));
  }
  await shot(page, 'adidas_3_product');

  // STEP 4 — Scroll down
  console.log('\n[4] Scrolling to see product details...');
  await page.mouse.wheel(0, 800);
  await sleep(1500);
  await shot(page, 'adidas_4_details');

  // STEP 5 — Try select size
  console.log('\n[5] Selecting a size...');
  try {
    const sizeBtn = page.locator('button[data-testid*="size"], button[class*="size"], [aria-label*="size" i]').first();
    await sizeBtn.waitFor({ state: 'visible', timeout: 5000 });
    await sizeBtn.click();
    await sleep(1000);
    console.log('[✓] Size clicked!');
  } catch {
    console.log('  [skip] sizes not visible at this point');
  }
  await shot(page, 'adidas_5_size');

  console.log('\n✅ ALL DONE! Edge stays open — you can see everything on your screen!');

  // Disconnect but keep Edge open
  await browser.close();
}

main().catch(err => {
  console.error('\n❌ ERROR:', err.message);
  process.exit(1);
});
