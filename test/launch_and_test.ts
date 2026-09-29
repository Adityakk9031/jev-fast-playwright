/**
 * launch_and_test.ts
 * Launches Edge with CDP, waits for port, then runs Adidas automation.
 * All in one script — no manual steps needed.
 */
import { chromium } from 'playwright';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';

const ARTIFACTS = 'C:\\Users\\user\\.gemini\\antigravity\\brain\\fae4c6f5-1e70-400a-83e7-10347250e5cd';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\user\\AppData\\Local\\Temp\\jev_edge_cdp';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function shot(page: any, name: string) {
  const p = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${name}.png saved`);
}

async function waitForCDP(maxMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log('\n🚀 JEV BRIDGE — EDGE LIVE DEMO (Adidas)');
  console.log('=========================================\n');

  // Kill old Edge
  cp.execSync('taskkill /F /IM msedge.exe /T 2>nul', { stdio: 'ignore' }).toString().trim();
  await sleep(1500);

  // Clean profile dir for fresh start with our flags
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });

  console.log('[0] Launching Edge with remote debugging port 9222...');
  const edgeProc = cp.spawn(EDGE, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${PROFILE}`,
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'https://www.adidas.com',
  ], { detached: true, stdio: 'ignore' });
  edgeProc.unref();

  console.log('[0] Waiting for Edge CDP port to be ready...');
  const ready = await waitForCDP(20000);
  if (!ready) {
    console.error('❌ CDP port 9222 never came up!');
    process.exit(1);
  }
  console.log('[✓] Edge is live on port 9222! Connecting...\n');

  // Connect Playwright to the VISIBLE Edge window
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const [context] = browser.contexts();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  page.on('dialog', async (d: any) => { console.log(`  [dialog] ${d.message()}`); await d.accept().catch(() => {}); });

  // ── STEP 1 ────────────────────────────────────────────────────────
  console.log('[1] Navigating to adidas.com...');
  let t = Date.now();
  await page.goto('https://www.adidas.com/us', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  console.log(`[✓] Adidas loaded in ${Date.now() - t}ms`);
  await shot(page, 'adidas_1_home');

  // ── STEP 2 ────────────────────────────────────────────────────────
  console.log('\n[2] Searching "running shoes"...');
  t = Date.now();
  try {
    // Click search icon
    await page.locator('[data-testid="header-search-input"], input[placeholder*="search" i], [aria-label*="search" i]').first().click({ timeout: 6000 });
    await sleep(400);
    await page.keyboard.type('running shoes', { delay: 80 });
    await page.keyboard.press('Enter');
    await sleep(3500);
    console.log(`[✓] Search in ${Date.now() - t}ms`);
  } catch {
    await page.goto('https://www.adidas.com/us/search?q=running+shoes', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    console.log('[✓] Search URL loaded');
  }
  await shot(page, 'adidas_2_search');

  // ── STEP 3 ────────────────────────────────────────────────────────
  console.log('\n[3] Clicking first product...');
  t = Date.now();
  try {
    const card = page.locator('[data-testid="product-card"], .glass-product-card, .product-card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    const name = await card.locator('p, h3, span').first().textContent().catch(() => 'product');
    console.log(`  Product: "${name?.trim().slice(0, 50)}"`);
    await card.click();
    await sleep(3500);
    console.log(`[✓] Product opened in ${Date.now() - t}ms`);
  } catch {
    console.log('  [skip] could not find product card');
  }
  await shot(page, 'adidas_3_product');

  // ── STEP 4 ────────────────────────────────────────────────────────
  console.log('\n[4] Scrolling down to see product details...');
  await page.mouse.wheel(0, 700);
  await sleep(1500);
  await shot(page, 'adidas_4_details');

  // ── STEP 5 ────────────────────────────────────────────────────────
  console.log('\n[5] Trying to select a size...');
  try {
    const sizeBtn = page.locator('[data-testid="size-selector-button"], button[class*="size"]').first();
    await sizeBtn.waitFor({ state: 'visible', timeout: 5000 });
    await sizeBtn.click();
    await sleep(1000);
    console.log('[✓] Size selected!');
    await shot(page, 'adidas_5_size');
  } catch {
    console.log('  [skip] size buttons not visible');
    await shot(page, 'adidas_5_scroll');
  }

  console.log('\n=========================================');
  console.log('✅ DONE! Edge stays open — watch your desktop!');
  console.log('   Press Ctrl+C here to close Edge.');
  console.log('=========================================\n');

  // Keep alive — don't close Edge
  await sleep(600_000);
  await browser.close();
}

main().catch(err => {
  console.error('\n❌ ERROR:', err.message);
  process.exit(1);
});
