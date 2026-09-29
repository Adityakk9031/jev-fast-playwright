/**
 * test/heuristicTest.ts
 *
 * Pure heuristic-selection tests — no browser, no network. The Jev client is
 * pointed at an unreachable port so selectElement() always falls back to the
 * labeled heuristic; these cases pin the behaviors that fix the Adidas
 * product-click failure (see context2.md):
 *   1. A short nav label ("Shoes") must not beat a specific product card.
 *   2. "not the nav shoes" phrasing must exclude the nav link.
 *   3. Existing behaviors (Demoblaze category, search field) must not regress.
 *
 * Run:  npm run test:heuristic
 */

import { JevClient } from '../src/jevClient';
import type { CompressedElement } from '../src/utils/compressDOM';

// Unreachable port → instant connection refused → heuristic fallback.
const jev = new JevClient({ apiKey: 'unit-test-key', baseUrl: 'http://127.0.0.1:9/v1', timeoutMs: 500 });

function el(partial: Partial<CompressedElement> & { id: string }): CompressedElement {
  return {
    tag: 'A',
    role: 'link',
    text: null,
    ariaLabel: null,
    placeholder: null,
    name: null,
    type: null,
    ...partial,
  };
}

const ADIDAS_LIKE: CompressedElement[] = [
  el({ id: 'Y', tag: 'A', role: 'link', text: 'Shoes', zone: 'header' }),
  el({ id: 'H', tag: 'BUTTON', role: 'button', text: 'Search', ariaLabel: 'Search', zone: 'header' }),
  el({ id: 'K1', tag: 'A', role: 'link', text: 'Adizero SL', ariaLabel: "Adizero SL Women's Running Shoes", zone: 'main' }),
  el({ id: 'K2', tag: 'A', role: 'link', text: 'Ultraboost 5 Running Shoes', zone: 'main' }),
  el({ id: 'F1', tag: 'A', role: 'link', text: 'Shipping & Returns', zone: 'footer' }),
];

const DEMOBLAZE_LIKE: CompressedElement[] = [
  el({ id: 'A1', tag: 'A', role: 'link', text: 'HOME', zone: 'header' }),
  el({ id: 'A3', tag: 'A', role: 'link', text: 'Laptops', zone: 'main' }),
  el({ id: 'A4', tag: 'A', role: 'link', text: 'Phones', zone: 'main' }),
  el({ id: 'A5', tag: 'A', role: 'link', text: 'Monitors', zone: 'main' }),
  el({ id: 'A2', tag: 'A', role: 'link', text: 'Cart', zone: 'header' }),
];

const INPUTS_ONLY: CompressedElement[] = [
  el({ id: 'S1', tag: 'INPUT', role: 'searchbox', text: null, ariaLabel: 'Search', placeholder: 'Search', type: 'search', zone: 'header' }),
  el({ id: 'E1', tag: 'INPUT', role: 'textbox', text: null, ariaLabel: 'Email address', placeholder: 'Email', type: 'email', zone: 'main' }),
];

let passed = 0;
let failed = 0;

function check(
  name: string,
  resp: { target_id: { choice: string; confidence: number }; source: string },
  expectedChoice: string | string[],
  opts: { minConfidence?: number; maxConfidence?: number } = {},
): void {
  const choices = Array.isArray(expectedChoice) ? expectedChoice : [expectedChoice];
  const okChoice = choices.includes(resp.target_id.choice);
  const okSource = resp.source === 'heuristic';
  const okMin = opts.minConfidence === undefined || resp.target_id.confidence >= opts.minConfidence;
  const okMax = opts.maxConfidence === undefined || resp.target_id.confidence <= opts.maxConfidence;
  const ok = okChoice && okSource && okMin && okMax;

  const detail =
    `choice=${resp.target_id.choice} conf=${(resp.target_id.confidence * 100).toFixed(0)}%` +
    ` (want ${choices.join('|')}` +
    `${opts.minConfidence !== undefined ? `, ≥${(opts.minConfidence * 100).toFixed(0)}%` : ''}` +
    `${opts.maxConfidence !== undefined ? `, ≤${(opts.maxConfidence * 100).toFixed(0)}%` : ''})`;

  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
  ok ? passed++ : failed++;
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Heuristic selection unit tests (no browser)');
  console.log('══════════════════════════════════════════════\n');

  // 1. The recorded Adidas failure: product card vs nav "Shoes" (no negation).
  check(
    'Adidas: product card beats nav "Shoes"',
    await jev.selectElement(ADIDAS_LIKE, 'open the product card for running shoes'),
    ['K1', 'K2'],
    { minConfidence: 0.78 },
  );

  // 2. Specific product name.
  check(
    'Adidas: named product "adizero sl" wins',
    await jev.selectElement(ADIDAS_LIKE, 'open the adizero sl product card'),
    'K1',
    { minConfidence: 0.78 },
  );

  // 3. Negation phrasing from the cheatsheet: nav must be excluded; with no
  //    product name given the right outcome is LOW confidence, never the nav.
  const r3 = await jev.selectElement(ADIDAS_LIKE, 'open the first product card (not the nav shoes)');
  check(
    'Adidas: "not the nav shoes" excluded → no nav click',
    { ...r3, target_id: { ...r3.target_id, choice: r3.target_id.choice === 'Y' ? 'Y' : 'not-Y' } },
    'not-Y',
    { maxConfidence: 0.75 },
  );

  // 4. Demoblaze category regression.
  check(
    'Demoblaze: "click Laptops"',
    await jev.selectElement(DEMOBLAZE_LIKE, 'click Laptops'),
    'A3',
    { minConfidence: 0.78 },
  );

  // 5. "open the cart" must still hit the header cart icon, not an add-to-cart button.
  const CART_LIKE: CompressedElement[] = [
    el({ id: 'C1', tag: 'A', role: 'link', text: 'Cart', zone: 'header' }),
    el({ id: 'P1', tag: 'BUTTON', role: 'button', text: 'Add to Cart', zone: 'main' }),
  ];
  check(
    'Cart icon: "open the cart"',
    await jev.selectElement(CART_LIKE, 'open the cart'),
    'C1',
    { minConfidence: 0.78 },
  );

  // 6. Search field selection (jev_type passes inputs only).
  check(
    'Search field: "type running shoes into the search field"',
    await jev.selectElement(INPUTS_ONLY, 'type running shoes into the search field'),
    'S1',
    { minConfidence: 0.78 },
  );

  // 7. Truly ambiguous target must stay below the auto-click gate.
  const r7 = await jev.selectElement(ADIDAS_LIKE, 'click it');
  check(
    'Ambiguous: "click it" stays low confidence',
    { ...r7, target_id: { ...r7.target_id, choice: r7.target_id.confidence < 0.75 ? 'low' : 'high' } },
    'low',
    { maxConfidence: 0.75 },
  );

  // 8. Results-page query-echoes: a top-of-page "Running Shoes" title link and
  //    a "Best Running Shoes" collection tile must lose to real product cards
  //    with richer text (the second recorded failure).
  const LISTING_LIKE: CompressedElement[] = [
    el({ id: 'T1', tag: 'A', role: 'link', text: 'Running Shoes', zone: 'main' }),
    el({ id: 'B1', tag: 'A', role: 'link', text: 'Best Running Shoes', zone: 'main' }),
    el({ id: 'P9', tag: 'A', role: 'link', text: 'Price $150 adizero Evo SL Running Shoes Men Performance', zone: 'main' }),
    el({ id: 'P8', tag: 'A', role: 'link', text: 'Price $120 Ultraboost 5 Running Shoes Men', zone: 'main' }),
  ];
  check(
    'Listing: product card beats title/collection echoes',
    await jev.selectElement(LISTING_LIKE, 'open the first running shoes product card'),
    ['P9', 'P8'],
    { minConfidence: 0.78 },
  );

  console.log('\n──────────────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('──────────────────────────────────────────────\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
