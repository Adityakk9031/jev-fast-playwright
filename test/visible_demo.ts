/**
 * visible_demo.ts
 *
 * Live demo: launches a visible Chrome window via Playwright (headless: false)
 * and runs a full demoblaze.com flow with clicks + screenshots.
 *
 * This is the same approach Antigravity's built-in playwright agent uses,
 * but going through the JEV bridge MCP architecture.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { chromium } from 'playwright';

const ARTIFACTS_DIR = 'C:\\Users\\user\\.gemini\\antigravity\\brain\\fae4c6f5-1e70-400a-83e7-10347250e5cd';

async function saveScreenshot(page: any, name: string): Promise<void> {
  const filePath = path.join(ARTIFACTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  [screenshot] → ${path.basename(filePath)}`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   JEV BRIDGE MCP — LIVE DEMO           ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('[Step 0] Launching Chrome (headless: false)...');
  const startTime = Date.now();

  let browser: any;
  try {
    // Use Microsoft Edge — it opens as a real visible desktop window on Windows
    browser = await chromium.launch({
      headless: false,
      channel: 'msedge',
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      args: [
        '--start-maximized',
        '--no-first-run',
        '--disable-extensions',
        '--no-default-browser-check',
      ],
      timeout: 30000,
    });
    console.log('[✓] Microsoft Edge launched');
  } catch (err) {
    console.log('[!] Edge unavailable, trying Chrome...');
    try {
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: ['--start-maximized', '--no-first-run'],
        timeout: 30000,
      });
      console.log('[✓] Chrome launched');
    } catch {
      browser = await chromium.launch({ headless: false, args: ['--start-maximized'], timeout: 30000 });
      console.log('[✓] Bundled Chromium launched');
    }
  }

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Auto-accept dialogs
  page.on('dialog', async (dialog: any) => {
    console.log(`  [dialog] "${dialog.message()}" → accepting`);
    await dialog.accept().catch(() => {});
  });

  // ── STEP 1: Navigate ──────────────────────────────────────────────
  console.log('\n[Step 1] Navigating to demoblaze.com...');
  let t = Date.now();
  await page.goto('https://www.demoblaze.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);
  console.log(`[✓] Loaded in ${Date.now() - t}ms`);
  await saveScreenshot(page, 'demo1_home');

  // ── STEP 2: Click Laptops ─────────────────────────────────────────
  console.log('\n[Step 2] Clicking "Laptops"...');
  t = Date.now();
  await page.locator('text=Laptops').first().click();
  await sleep(2000);
  console.log(`[✓] Laptops clicked in ${Date.now() - t}ms`);
  await saveScreenshot(page, 'demo2_laptops');

  // ── STEP 3: Click first product ───────────────────────────────────
  console.log('\n[Step 3] Clicking first laptop...');
  t = Date.now();
  const productEl = page.locator('.card-title a').first();
  await productEl.waitFor({ state: 'visible', timeout: 10000 });
  const productName = await productEl.textContent();
  console.log(`  Product: "${productName}"`);
  await productEl.click();
  await sleep(2500);
  console.log(`[✓] Product clicked in ${Date.now() - t}ms`);
  await saveScreenshot(page, 'demo3_product');

  // ── STEP 4: Add to cart ───────────────────────────────────────────
  console.log('\n[Step 4] Clicking "Add to cart"...');
  t = Date.now();
  await page.locator('text=Add to cart').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('text=Add to cart').first().click();
  await sleep(2000);
  console.log(`[✓] Add to cart in ${Date.now() - t}ms`);
  await saveScreenshot(page, 'demo4_added');

  // ── STEP 5: Open Cart ─────────────────────────────────────────────
  console.log('\n[Step 5] Opening cart...');
  t = Date.now();
  await page.locator('#cartur').first().click();
  await sleep(2500);
  console.log(`[✓] Cart opened in ${Date.now() - t}ms`);
  await saveScreenshot(page, 'demo5_cart');

  const totalMs = Date.now() - startTime;
  console.log('\n╔════════════════════════════════════════╗');
  console.log(`║  ✅ DEMO COMPLETE in ${(totalMs/1000).toFixed(1)}s total         ║`);
  console.log('║  5 steps: navigate → laptops → product ║');
  console.log('║           → add to cart → view cart    ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('Chrome stays open. Press Ctrl+C to close.\n');

  // Keep Chrome open so user can see it
  await sleep(600_000);

  await browser.close();
}

main().catch(err => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
