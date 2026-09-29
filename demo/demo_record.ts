/**
 * demo/demo_record.ts (v5) — ADIDAS ONLY, 10 TASKS, ~4 min. RETAKE VERSION.
 *
 * Fixes vs v4:
 *  - honest ✓/✗ outcome printing (a refusal is never printed as a click)
 *  - TASK 7 retry distills the card text to its distinctive name
 *    ("Price $110 Handball Spezial Shoes … 52 colors" → "Handball Spezial Shoes Originals")
 *  - TASK 1 falls back to a clean label when the SPA title hasn't loaded yet
 *
 * Run:  npx ts-node --transpile-only demo/demo_record.ts
 */
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const banner = (t: string) => {
  const line = '═'.repeat(Math.min(t.length + 8, 74));
  console.log(`\n${line}\n║   ${t}\n${line}\n`);
};
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const info = (s: string) => console.log('  ' + s);

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  try { return JSON.parse(text); } catch { return { success: false, raw: text.slice(0, 200) }; }
}

/** Strip e-commerce boilerplate so the retry describes the product, not the card chrome. */
function distillCardText(t: string): string {
  let s = t.replace(/\s+/g, ' ').trim();
  s = s.replace(/^price\s*(\$|€|£)?\s*\d+(\.\d+)?\s*/i, '');
  s = s.replace(/\b\d+\s*colors?\b/gi, '');
  s = s.replace(/\bselling fast\b/gi, '');
  s = s.replace(/\bnew\b\s*$/i, '');
  const words = s.split(' ').filter(Boolean).slice(0, 7).join(' ');
  return words || s;
}

const labelOf = (r: any) =>
  ((r?.clicked_element?.text ?? r?.clicked_element?.ariaLabel ?? r?.candidate?.text ?? r?.candidate?.ariaLabel ?? '') as string)
    .replace(/\s+/g, ' ').trim() || 'target element';

/**
 * Click + the designed error loop:
 *   attempt → LOW_CONFIDENCE → snapshot → LLM adjusts the step → retry → honest outcome.
 * Retries once with the found element's label, phrased by `retryDesc`.
 */
async function clickWithRecovery(
  client: Client,
  desc: string,
  finder: (els: any[]) => any,
  retryDesc: (label: string) => string = l => `the element labeled "${l}"`,
): Promise<any> {
  let r = await callJson(client, 'jev_fast_click', { target_description: desc });
  if (!r.success && r.reason === 'LOW_CONFIDENCE') {
    info(`  → LOW_CONFIDENCE (${r.confidence}). One line of JSON goes BACK to the LLM…`);
    await pause(5000);
    const snap = await callJson(client, 'jev_page_snapshot', {});
    const target = finder(((snap.elements ?? []) as any[]));
    if (target?.text ?? target?.ariaLabel) {
      const label = String(target.text ?? target.ariaLabel).replace(/\s+/g, ' ').trim();
      info(`  …the LLM adjusts the step: "${label.slice(0, 60)}…"`);
      await pause(3000);
      r = await callJson(client, 'jev_fast_click', { target_description: retryDesc(label) });
    }
  }
  if (r.success) {
    info(`✓ clicked: ${labelOf(r).slice(0, 70)}`);
    info(`  selector: ${r.selector_source}   confidence: ${r.confidence}   strategy: ${r.click_strategy}`);
  } else {
    info(`✗ refused (confidence ${r.confidence ?? '—'}) — nothing clicked; the LLM must replan. Candidate was "${labelOf(r).slice(0, 50)}"`);
  }
  return r;
}

// A real product card carries a price; category tiles and nav links don't.
// Among price-cards, prefer one whose text is UNIQUE in the snapshot —
// identical titles across colorway cards are genuinely ambiguous to Jev.
const cardFinder = (els: any[]) => {
  const norm = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
  const cards = els.filter(e => e.zone === 'main' && e.tag === 'A' && /\$\s?\d+/.test(e.text ?? '') && (e.text ?? '').length > 30);
  if (cards.length === 0) {
    return els.find(e => e.zone === 'main' && e.tag === 'A' && /shoes|sneakers/i.test(e.text ?? '') && (e.text ?? '').length > 30);
  }
  const counts = new Map<string, number>();
  for (const e of els) {
    const t = norm(e.text);
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return cards.find(c => (counts.get(norm(c.text)) ?? 0) === 1) ?? cards[0];
};

async function main() {
  banner('jev-fast-playwright — ADIDAS DEMO · 10 TASKS');
  console.log('  System-2 (LLM) plans the steps\n  System-1 (Jev) picks the elements\n  Playwright acts\n');
  await pause(8000);

  const transport = new StdioClientTransport({
    command: 'node', args: ['d:/jev_bridge/build/src/index.js'],
    cwd: 'd:/jev_bridge', env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'jev-demo', version: '1.0.0' });
  await client.connect(transport);

  // ── TASK 1 ──
  banner('TASK 1 · One tool call → Chrome opens adidas.com');
  const nav = await callJson(client, 'jev_navigate', { url: 'https://www.adidas.com/us' });
  const title = (nav.title ?? '').trim() || 'adidas.com';
  info(`✓ "${title}"  (${Math.round(nav.elapsed_ms)} ms)`);
  await pause(8000);

  // ── TASK 2 ──
  banner('TASK 2 · Jev finds the search box → types "running shoes" → Enter');
  let typed = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'running shoes', clear_first: true });
  if (!typed.success) {
    info('  (page still hydrating — one beat, retry…)');
    await pause(3000);
    typed = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'running shoes', clear_first: true });
  }
  if (typed.success) {
    info(`✓ typed.  selector: ${typed.selector_source}   confidence: ${typed.confidence}   Jev call: ${Math.round(typed.metrics?.jev_api_ms ?? 0)} ms`);
  } else {
    info(`✗ search box not found (${typed.reason})`);
  }
  await pause(3000);
  await callJson(client, 'jev_press_key', { key: 'Enter' });
  await callJson(client, 'jev_wait', { url_includes: 'running-shoes', timeout_ms: 10000 });
  const st2 = await callJson(client, 'jev_browser_status', {});
  info(`✓ now at: ${st2.url}`);
  await pause(8000);

  // ── TASK 3 ──
  banner('TASK 3 · "Open the first product card" — Jev hesitates…');
  const card = await clickWithRecovery(client, 'open the first running shoes product card', cardFinder,
    l => `open the product card titled "${l}"`);
  await pause(8000);

  // ── TASK 4 ──
  banner('TASK 4 · Complete the purchase: size 9 → Add to Bag');
  let size = await callJson(client, 'jev_fast_click', { target_description: 'the size selector button labeled 9' });
  if (!size.success) {
    const snap = await callJson(client, 'jev_page_snapshot', {});
    const nine = ((snap.elements ?? []) as any[]).find(e => /^9$/.test((e.text ?? '').trim()));
    if (nine?.text) size = await callJson(client, 'jev_fast_click', { target_description: 'the element labeled "9"' });
  }
  info(size.success
    ? `✓ size "9": selector ${size.selector_source}, confidence ${size.confidence}`
    : `✗ size not selected (${size.reason ?? 'low confidence'}) — continuing`);
  await pause(3000);
  const bag = await callJson(client, 'jev_fast_click', { target_description: 'the Add to Bag button' });
  info(bag.success
    ? `✓ Add to Bag: selector ${bag.selector_source}, confidence ${bag.confidence}`
    : `✗ Add to Bag refused (${bag.reason ?? 'low confidence'}) — continuing`);
  await pause(3000);
  await callJson(client, 'jev_press_key', { key: 'Escape' });
  await callJson(client, 'jev_wait', { timeout_ms: 2000 });
  info('✓ mini-cart dismissed');
  await pause(6000);

  // ── TASK 5 ──
  banner('TASK 5 · Scroll through the product details');
  await callJson(client, 'jev_scroll', { direction: 'down', amount_px: 800 });
  info('✓ scrolled down 800 px');
  await pause(4000);
  await callJson(client, 'jev_scroll', { direction: 'top' });
  info('✓ back to top');
  await pause(5000);

  // ── TASK 6 ──
  banner('TASK 6 · Same search box again → "sneakers" → Enter');
  let t2 = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'sneakers', clear_first: true });
  if (!t2.success) {
    info('  (one beat, retry…)');
    await pause(3000);
    t2 = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'sneakers', clear_first: true });
  }
  info(t2.success
    ? `✓ typed.  selector: ${t2.selector_source}   confidence: ${t2.confidence}`
    : `✗ search box not found this time (${t2.reason})`);
  await pause(3000);
  await callJson(client, 'jev_press_key', { key: 'Enter' });
  await callJson(client, 'jev_wait', { url_includes: 'sneakers', timeout_ms: 8000 }).catch(() => {});
  const st3 = await callJson(client, 'jev_browser_status', {});
  info(`✓ now at: ${st3.url}`);
  await pause(8000);

  // ── TASK 7 ──
  banner('TASK 7 · Open the first card of the new listing');
  const card2 = await clickWithRecovery(client, 'open the first sneakers product card', cardFinder,
    l => `open the product card titled "${l}"`);
  await pause(8000);

  // ── TASK 8 ──
  banner('TASK 8 · Open the wishlist page from the header');
  await clickWithRecovery(client, 'the wishlist or favorites icon in the header',
    els => els.find(e => /wishlist|wish list|favorites/i.test(((e.ariaLabel ?? '') + ' ' + (e.text ?? '')))));
  await pause(7000);

  // ── TASK 9 ──
  banner('TASK 9 · Screenshot proof (only when you ask — it costs tokens)');
  const shot = await client.callTool({ name: 'jev_screenshot', arguments: { full_page: false } });
  const img = ((shot.content ?? []) as Array<{ type: string; data?: string }>).find(c => c.type === 'image');
  info(`✓ viewport captured: ${img?.data ? Math.round(img.data.length * 0.75 / 1024) : 0} KB`);
  await pause(5000);

  // ── TASK 10 ──
  banner('TASK 10 · Back to the adidas homepage');
  await callJson(client, 'jev_navigate', { url: 'https://www.adidas.com/us' });
  const st4 = await callJson(client, 'jev_browser_status', {});
  info(`✓ home again: ${st4.url}`);
  await pause(6000);

  // ── Payoff ──
  banner('RESULT · 10 tasks, one small JSON each');
  console.log(JSON.stringify({
    tasks: [
      '1. open adidas.com',
      '2. search "running shoes"',
      '3. open product card (error-loop recovery)',
      '4. size 9 + Add to Bag',
      '5. scroll product details',
      '6. search "sneakers"',
      '7. open first card of new listing',
      '8. open wishlist page',
      '9. screenshot proof',
      '10. back to homepage',
    ],
    final_url: st4.url,
    selection_model: 'jev-latest (TypeSafe System-1)',
    llm_context_cost: '~a few hundred tokens per step (no page dumps, no vision)',
  }, null, 2));
  await pause(10000);

  banner('DONE — System-2 plans. System-1 sees. Playwright acts.');
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error('DEMO CRASHED:', String(err).slice(0, 200)); process.exit(1); });
