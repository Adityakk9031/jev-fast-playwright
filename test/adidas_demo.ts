/**
 * adidas_demo.ts - Live Edge demo on Adidas website
 */
import { chromium } from 'playwright';
import * as path from 'path';

const ARTIFACTS_DIR = 'C:\\Users\\user\\.gemini\\antigravity\\brain\\fae4c6f5-1e70-400a-83e7-10347250e5cd';

async function shot(page: any, name: string) {
  const p = path.join(ARTIFACTS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n🚀 JEV BRIDGE — LIVE EDGE DEMO (Adidas)');
  console.log('=========================================\n');

  console.log('[0] Opening Microsoft Edge...');
  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge',
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    timeout: 30000,
  });
  console.log('[✓] Edge is open on your desktop!\n');

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  page.on('dialog', async (d: any) => { await d.accept().catch(() => {}); });

  // STEP 1 — Navigate to Adidas
  console.log('[1] Going to adidas.com...');
  let t = Date.now();
  await page.goto('https://www.adidas.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  console.log(`[✓] Adidas loaded in ${Date.now() - t}ms`);
  await shot(page, 'adidas_1_home');

  // STEP 2 — Search for shoes
  console.log('\n[2] Searching for "running shoes"...');
  t = Date.now();
  try {
    // Try clicking search icon
    const searchBtn = page.locator('[data-testid="search-input"], input[type="search"], [aria-label*="search" i], .search-field').first();
    await searchBtn.waitFor({ state: 'visible', timeout: 5000 });
    await searchBtn.click();
    await sleep(500);
    await page.keyboard.type('running shoes', { delay: 80 });
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(3000);
    console.log(`[✓] Search done in ${Date.now() - t}ms`);
  } catch {
    // Fallback: go direct to search URL
    console.log('  [fallback] navigating to search URL directly...');
    await page.goto('https://www.adidas.com/us/search?q=running+shoes', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    console.log(`[✓] Search results loaded`);
  }
  await shot(page, 'adidas_2_search');

  // STEP 3 — Click first product
  console.log('\n[3] Clicking first product...');
  t = Date.now();
  try {
    const product = page.locator('[data-testid="product-card"] a, .product-card a, .glass-product-card a').first();
    await product.waitFor({ state: 'visible', timeout: 8000 });
    const productText = await product.textContent().catch(() => 'product');
    console.log(`  Found: "${productText?.trim().slice(0, 60)}"`);
    await product.click();
    await sleep(3000);
    console.log(`[✓] Product opened in ${Date.now() - t}ms`);
  } catch {
    console.log('  [skip] product click — layout differs, taking screenshot');
  }
  await shot(page, 'adidas_3_product');

  // STEP 4 — Scroll down to see details
  console.log('\n[4] Scrolling down to see product details...');
  await page.mouse.wheel(0, 600);
  await sleep(1500);
  await shot(page, 'adidas_4_details');

  console.log('\n=========================================');
  console.log('✅ DONE! Edge stays open — check your desktop!');
  console.log('=========================================\n');

  // Keep Edge open for 10 minutes
  await sleep(600_000);
  await browser.close();
}

main().catch(err => {
  console.error('\n❌ ERROR:', err.message);
  process.exit(1);
});
