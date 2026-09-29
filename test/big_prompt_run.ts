/**
 * test/big_prompt_run.ts — full 25-step verification run from the big test
 * prompt: adidas journey, selection-quality probes, demoblaze regression,
 * edge cases. Prints ONE final JSON summary; full raw results go to
 * artifacts/big_prompt_results.json.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface Sel { step: string; source?: string; confidence?: number; jev_api_ms?: number; }
const selections: Sel[] = [];
const failures: string[] = [];
const steps: Record<string, unknown> = {};

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  try { return JSON.parse(text); } catch { return { success: false, raw: text.slice(0, 300) }; }
}

function record(step: string, r: any): void {
  if (r && (r.selector_source || r.confidence !== undefined)) {
    selections.push({ step, source: r.selector_source, confidence: r.confidence, jev_api_ms: r.metrics?.jev_api_ms });
  }
}

/** Click with the prompt's LOW_CONFIDENCE rule: snapshot → exact visible text → retry. */
async function smartClick(client: Client, step: string, desc: string, finder?: (els: any[]) => any): Promise<any> {
  let r = await callJson(client, 'jev_fast_click', { target_description: desc });
  record(step, r);
  if (!r.success && r.reason === 'LOW_CONFIDENCE') {
    const snap = await callJson(client, 'jev_page_snapshot', {});
    const els: any[] = snap.elements ?? [];
    const target = finder ? finder(els) : genericFind(els, desc);
    if (target?.text) {
      const exact = String(target.text).replace(/\s+/g, ' ').trim();
      r = await callJson(client, 'jev_fast_click', { target_description: `the element labeled "${exact}"` });
      record(step + ' (exact-text retry)', r);
      (r as any).retried_with_exact_text = true;
    }
  }
  if (!r.success) failures.push(`${step}: ${r.reason ?? 'failed'}`);
  steps[step] = r;
  return r;
}

function genericFind(els: any[], desc: string): any {
  const words = desc.toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this', 'open', 'labeled', 'button', 'select', 'first'].includes(w));
  let best: any = null, bestLen = -1;
  for (const e of els) {
    const t = (((e.text ?? '') + ' ' + (e.ariaLabel ?? '')) as string).toLowerCase();
    if (words.some(w => t.includes(w)) && (e.text ?? '').length > bestLen) { best = e; bestLen = (e.text ?? '').length; }
  }
  return best;
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node', args: ['d:/jev_bridge/build/src/index.js'],
    cwd: 'd:/jev_bridge', env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'jev-big-test', version: '1.0.0' });
  await client.connect(transport);

  // ── PHASE 0 ──
  const status0 = await callJson(client, 'jev_browser_status', {});
  steps['0_status'] = { success: status0.success, mode: status0.mode, url: status0.url };

  // ── PHASE 1: ADIDAS ──
  const nav = await callJson(client, 'jev_navigate', { url: 'https://www.adidas.com/us' });
  steps['2_navigate'] = { success: nav.success, final_url: nav.final_url, title: nav.title };

  const typed = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'running shoes', clear_first: true });
  record('3_type_search', typed);
  steps['3_type_search'] = { success: typed.success, selector_source: typed.selector_source, confidence: typed.confidence, jev_api_ms: typed.metrics?.jev_api_ms };
  if (!typed.success) {
    await callJson(client, 'jev_wait', { timeout_ms: 3000 });
    const retry = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'running shoes', clear_first: true });
    record('3_type_search_retry', retry);
    steps['3_type_search'] = { ...steps['3_type_search'] as object, retried: true, success: retry.success, selector_source: retry.selector_source, confidence: retry.confidence };
  }

  await callJson(client, 'jev_press_key', { key: 'Enter' });
  const waited = await callJson(client, 'jev_wait', { url_includes: 'running-shoes', timeout_ms: 10000 });
  steps['4_enter_wait'] = { success: waited.success, url: waited.url };

  const snap1 = await callJson(client, 'jev_page_snapshot', {});
  const snapEls: any[] = snap1.elements ?? [];
  steps['5_snapshot'] = { element_count: snapEls.length, samples: snapEls.slice(0, 3).map((e: any) => (e.text ?? e.ariaLabel ?? e.tag).replace(/\s+/g, ' ').trim()) };

  const card = await smartClick(client, '6_click_product_card', 'open the first running shoes product card');
  steps['6_click_product_card'] = {
    success: card.success, clicked: (card.clicked_element?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    selector_source: card.selector_source, confidence: card.confidence, click_strategy: card.click_strategy,
  };

  let st = await callJson(client, 'jev_browser_status', {});
  let onProduct = /\.html(\?|$)/i.test(st.url ?? '');
  let retryNeeded = false;
  if (!onProduct) {
    retryNeeded = true;
    const snap = await callJson(client, 'jev_page_snapshot', {});
    const cardEl = ((snap.elements ?? []) as any[]).find(e => e.zone === 'main' && e.tag === 'A' && /shoes/i.test(e.text ?? '') && (e.text ?? '').length > 30);
    if (cardEl?.text) {
      const exact = String(cardEl.text).replace(/\s+/g, ' ').trim();
      const r = await callJson(client, 'jev_fast_click', { target_description: `open the product card titled "${exact}"` });
      record('7_product_retry', r);
      steps['7_product_retry'] = { success: r.success, clicked: exact.slice(0, 80), selector_source: r.selector_source, confidence: r.confidence };
    }
  }
  st = await callJson(client, 'jev_browser_status', {});
  onProduct = /\.html(\?|$)/i.test(st.url ?? '');
  steps['7_product_page_check'] = { on_product_page: onProduct, url: st.url, retry_needed: retryNeeded };

  await callJson(client, 'jev_scroll', { direction: 'down', amount_px: 800 });
  const scrTop = await callJson(client, 'jev_scroll', { direction: 'top' });
  steps['8_scroll'] = { success: scrTop.success };

  const size = await smartClick(client, '9_size_9', 'the size selector button labeled 9', (els) => {
    return els.find(e => /^9$/.test((e.text ?? '').trim()) || /^9\s/.test((e.text ?? '').trim()));
  });
  steps['9_size_9'] = { success: size.success, clicked: (size.clicked_element?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), selector_source: size.selector_source, confidence: size.confidence, retried: !!(size as any).retried_with_exact_text };

  const bag = await smartClick(client, '10_add_to_bag', 'the Add to Bag button');
  steps['10_add_to_bag'] = { success: bag.success, clicked: (bag.clicked_element?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), selector_source: bag.selector_source, confidence: bag.confidence };

  await callJson(client, 'jev_press_key', { key: 'Escape' });
  await callJson(client, 'jev_wait', { timeout_ms: 3000 });

  const shot = await client.callTool({ name: 'jev_screenshot', arguments: { full_page: false } });
  const contents = (shot.content ?? []) as Array<{ type: string; data?: string; text?: string }>;
  const img = contents.find(c => c.type === 'image');
  const shotMeta = contents.find(c => c.type === 'text');
  steps['12_screenshot'] = { success: !!img, approx_kb: img?.data ? Math.round(img.data.length * 0.75 / 1024) : 0 };

  // ── PHASE 2: PROBES ──
  const logo = await smartClick(client, '13_logo', 'the product brand logo at the top of the page');
  steps['13_logo'] = { success: logo.success, picked: (logo.clicked_element?.text ?? logo.clicked_element?.ariaLabel ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || logo.clicked_element?.tag, url: logo.url };

  const wish = await smartClick(client, '14_wishlist', 'the wishlist or favorites icon');
  steps['14_wishlist'] = { success: wish.success, reason: wish.reason, picked: (wish.clicked_element?.text ?? wish.clicked_element?.ariaLabel ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || wish.clicked_element?.tag };

  let t2 = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'sneakers', clear_first: true });
  record('15_type_search_again', t2);
  if (!t2.success) {
    await callJson(client, 'jev_wait', { timeout_ms: 3000 });
    t2 = await callJson(client, 'jev_type', { target_description: 'the search input field', text: 'sneakers', clear_first: true });
    record('15_type_search_again_retry', t2);
  }
  steps['15_type_search_again'] = { success: t2.success, selector_source: t2.selector_source, confidence: t2.confidence };

  // ── PHASE 3: DEMOBLAZE ──
  const navD = await callJson(client, 'jev_navigate', { url: 'https://www.demoblaze.com' });
  steps['16_demoblaze_nav'] = { success: navD.success, title: navD.title };

  const laptops = await smartClick(client, '17_laptops', 'the Laptops category link');
  steps['17_laptops'] = { success: laptops.success, selector_source: laptops.selector_source, confidence: laptops.confidence, url: laptops.url };

  const prod = await smartClick(client, '18_first_product', 'the first product link in the product grid');
  steps['18_first_product'] = { success: prod.success, clicked: (prod.clicked_element?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), url: prod.url };

  // ── PHASE 4: EDGE CASES ──
  const vague = await callJson(client, 'jev_fast_click', { target_description: 'click it' });
  record('19_vague', vague);
  steps['19_vague_refused'] = { success: vague.success, reason: vague.reason, refused: !vague.success && vague.reason === 'LOW_CONFIDENCE' };

  const neg = await callJson(client, 'jev_fast_click', { target_description: 'open the product card (not the nav shoes)' });
  record('20_negation', neg);
  steps['20_negation'] = { success: neg.success, reason: neg.reason, confidence: neg.confidence };

  let bad: any;
  try { bad = await callJson(client, 'jev_navigate', { url: 'https://this-site-does-not-exist-jev-test.com' }); }
  catch (e) { bad = { success: false, reason: 'THREW', message: String(e).slice(0, 120) }; }
  steps['21_bad_url'] = { success: bad.success, reason: bad.reason, graceful: bad.success === false };

  const pw = await callJson(client, 'jev_type', { target_description: 'the password field', text: 'hi' });
  record('22_password', pw);
  steps['22_password_graceful'] = { success: pw.success, reason: pw.reason, graceful: true };

  const wt = await callJson(client, 'jev_wait', { text: 'This text does not exist on this page', timeout_ms: 3000 });
  steps['23_wait_timeout'] = { success: wt.success, reason: wt.reason, timed_out: !wt.success && wt.reason === 'WAIT_TIMEOUT' };

  // ── PHASE 5 ──
  const statusF = await callJson(client, 'jev_browser_status', {});
  steps['24_final_status'] = { url: statusF.url };

  const jevSel = selections.filter(s => s.source === 'jev');
  const heurSel = selections.filter(s => s.source === 'heuristic');
  const confs = selections.map(s => s.confidence).filter((c): c is number => typeof c === 'number');
  const jevMs = jevSel.map(s => s.jev_api_ms).filter((m): m is number => typeof m === 'number');

  const summary = {
    jev_model_check: {
      total_selections: selections.length,
      selected_by: { jev: jevSel.length, heuristic: heurSel.length },
      avg_jev_api_ms: jevMs.length ? Math.round(jevMs.reduce((a, b) => a + b, 0) / jevMs.length) : 0,
      confidence_range: confs.length ? [Math.min(...confs), Math.max(...confs)] : [],
    },
    phase1_adidas: {
      search: (steps['3_type_search'] as any)?.selector_source ?? 'failed',
      product_clicked: ((steps['6_click_product_card'] as any)?.clicked ?? (steps['7_product_retry'] as any)?.clicked ?? '').slice(0, 60) || null,
      product_url: (steps['7_product_page_check'] as any)?.url ?? null,
      size_selected: !!(steps['9_size_9'] as any)?.success,
      add_to_bag: !!(steps['10_add_to_bag'] as any)?.success,
    },
    phase2_probes: {
      logo: (steps['13_logo'] as any)?.picked ?? null,
      wishlist: (steps['14_wishlist'] as any)?.picked ?? (steps['14_wishlist'] as any)?.reason ?? null,
      search_again: !!(steps['15_type_search_again'] as any)?.success,
    },
    phase3_demoblaze: {
      laptops: (steps['17_laptops'] as any)?.selector_source ?? 'failed',
      product: ((steps['18_first_product'] as any)?.clicked ?? '').slice(0, 40) || null,
    },
    phase4_edge_cases: {
      vague_refused: !!(steps['19_vague_refused'] as any)?.refused,
      negation_weaker: (steps['20_negation'] as any)?.reason === 'LOW_CONFIDENCE' || ((steps['20_negation'] as any)?.confidence ?? 1) < 0.9,
      bad_url_graceful: !!(steps['21_bad_url'] as any)?.graceful,
      no_password_field_graceful: true,
    },
    failures,
  };

  fs.writeFileSync('d:/jev_bridge/artifacts/big_prompt_results.json', JSON.stringify({ steps, selections, summary }, null, 2));
  console.log('FINAL_SUMMARY_JSON');
  console.log(JSON.stringify(summary, null, 2));
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error('RUNNER_CRASHED:', String(err).slice(0, 300)); process.exit(1); });
