/**
 * test/adidas_mcp_test.ts
 *
 * End-to-end regression test for the Adidas product-click fix (context2.md):
 * spawns the REAL MCP server over stdio (exactly like Cursor does) and runs
 * the recorded failing flow — navigate → search → click a product card while
 * explicitly excluding the nav "Shoes" link.
 *
 * Launch mode: opens a visible Chrome window.
 * Run:  PLAYWRIGHT_BROWSERS_PATH=D:\\tools\\playwright-browsers npm run test:adidas
 */

import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_SERVER = 'd:/jev_bridge/build/src/index.js';

interface ToolJson {
  success: boolean;
  reason?: string;
  message?: string;
  final_url?: string;
  url?: string;
  title?: string;
  clicked_element?: { text?: string | null; tag?: string; role?: string };
  confidence?: number;
  selector_source?: string;
  click_strategy?: string;
  dismissed_overlay?: string | null;
}

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<ToolJson> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }> | undefined)
    ?.filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('') ?? '';
  try {
    return JSON.parse(text) as ToolJson;
  } catch {
    return { success: false, reason: 'UNPARSEABLE', message: text.slice(0, 500) };
  }
}

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Adidas product-click E2E (real MCP server, launch mode)');
  console.log('══════════════════════════════════════════════════\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_SERVER],
    cwd: 'd:/jev_bridge',
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'jev-adidas-e2e', version: '1.0.0' });
  await client.connect(transport);
  console.log('[ok] MCP server connected (spawns its own Chrome in launch mode)\n');

  let failed = 0;
  const t0 = Date.now();

  // 1 — status
  const status = await callJson(client, 'jev_browser_status', {});
  console.log(`[1] status: ready=${status.success} mode=${JSON.stringify(status).slice(0, 120)}`);
  if (!status.success) failed++;

  // 2 — navigate
  const nav = await callJson(client, 'jev_navigate', { url: 'https://www.adidas.com/us' });
  console.log(`[2] navigate: ${nav.success} → ${nav.final_url ?? ''} "${nav.title ?? ''}" (${Date.now() - t0}ms)`);
  if (!nav.success) {
    console.log('    FATAL: navigation failed — aborting');
    process.exitCode = 1;
    await client.close();
    return;
  }

  // 3 — search (settle wait first: adidas hydrates lazily; fall back to search URL)
  await callJson(client, 'jev_wait', { timeout_ms: 4000 });
  let typed = await callJson(client, 'jev_type', {
    target_description: 'the search input field',
    text: 'running shoes',
    clear_first: true,
  });
  console.log(`[3] type: ${typed.success} (${typed.message ?? ''})`);
  if (!typed.success) {
    await callJson(client, 'jev_press_key', { key: 'Escape' });
    const navSearch = await callJson(client, 'jev_navigate', {
      url: 'https://www.adidas.com/us/search?q=running%20shoes',
    });
    console.log(`    fallback → direct search URL: ${navSearch.success} → ${navSearch.final_url ?? ''}`);
  } else {
    await callJson(client, 'jev_press_key', { key: 'Enter' });
  }
  await callJson(client, 'jev_wait', { timeout_ms: 8000 });
  const after = await callJson(client, 'jev_browser_status', {});
  console.log(`    landed on: ${after.url ?? ''}`);

  // 4 — THE REGRESSION: click a product card, explicitly excluding nav "Shoes"
  let click = await callJson(client, 'jev_fast_click', {
    target_description: 'open the first product card (not the nav shoes)',
  });
  if (!click.success && click.reason === 'LOW_CONFIDENCE') {
    console.log('    retrying with a more specific description…');
    click = await callJson(client, 'jev_fast_click', {
      target_description: 'open the first running shoes product card',
    });
  }
  console.log(`[4] fast_click: ${JSON.stringify({
    success: click.success,
    reason: click.reason,
    clicked: click.clicked_element?.text ?? click.clicked_element?.tag,
    confidence: click.confidence,
    source: click.selector_source,
    strategy: click.click_strategy,
    dismissed: click.dismissed_overlay,
  })}`);
  console.log(`    message: ${click.message ?? ''}`);

  await callJson(client, 'jev_wait', { timeout_ms: 6000 });
  const final = await callJson(client, 'jev_browser_status', {});
  const finalUrl = final.url ?? '';

  console.log(`\n    final URL: ${finalUrl}`);

  // Verdict: a product page URL (deep path) vs staying on the listing / nav page.
  const onListing = /\/us\/running-shoes\/?(\?.*)?$/.test(finalUrl) || /\/us\/?(\?.*)?$/.test(finalUrl);
  const productLike = /\/us\/[a-z0-9-]+\/[a-z0-9-]+\.html(\?.*)?$/i.test(finalUrl) && !onListing;
  if (click.success && productLike) {
    console.log('\n✅ PASS — product card clicked (not the nav link), landed on a product page');
  } else if (!click.success && click.reason === 'LOW_CONFIDENCE') {
    console.log('\n⚠️  PARTIAL — heuristic refused to click the nav link (no wrong click), but no product click either');
    failed++;
  } else {
    console.log('\n❌ FAIL — see click JSON above');
    failed++;
  }

  await client.close();
  console.log(`\nTotal wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('E2E runner crashed:', err);
  process.exit(1);
});
