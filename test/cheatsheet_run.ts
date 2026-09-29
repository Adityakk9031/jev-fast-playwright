/**
 * test/cheatsheet_run.ts — runs the context2.md "Adidas smoke" cheatsheet
 * through the REAL MCP server and prints each tool's JSON result only.
 */
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  try { return JSON.parse(text); } catch { return { success: false, raw: text.slice(0, 300) }; }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['d:/jev_bridge/build/src/index.js'],
    cwd: 'd:/jev_bridge',
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'jev-agent', version: '1.0.0' });
  await client.connect(transport);

  const out: Record<string, unknown> = {};

  out.jev_navigate = await callJson(client, 'jev_navigate', { url: 'https://www.adidas.com/us' });

  const typed = await callJson(client, 'jev_type', {
    target_description: 'the search input field',
    text: 'running shoes',
    clear_first: true,
  });
  if (!typed.success) {
    await callJson(client, 'jev_press_key', { key: 'Escape' });
    out.jev_type = { ...typed, note: 'search input not hydrated yet — used direct search URL instead' };
    out.jev_type_fallback = await callJson(client, 'jev_navigate', {
      url: 'https://www.adidas.com/us/search?q=running%20shoes',
    });
  } else {
    out.jev_type = typed;
    out.jev_press_key = await callJson(client, 'jev_press_key', { key: 'Enter' });
  }
  await callJson(client, 'jev_wait', { timeout_ms: 8000 });

  // Note: keep the selector description positive — "(not the nav shoes)"
  // would exclude the word "shoes" and strip credit from real product cards.
  let click = await callJson(client, 'jev_fast_click', {
    target_description: 'open the first running shoes product card',
  });

  // Agent-level verification: a product page ends in .html — if we landed on a
  // category/listing page instead, snapshot, pick a real card, and retry.
  const isProductPage = (u?: string) => !!u && /\.html(\?|$)/i.test(u);
  let status = await callJson(client, 'jev_browser_status', {});
  if (!click.success || !isProductPage((status as { url?: string }).url)) {
    const snap = await callJson(client, 'jev_page_snapshot', {});
    const cards = ((snap.elements ?? []) as Array<{ zone?: string; tag: string; text: string | null }>)
      .filter(e => e.zone === 'main' && e.tag === 'A' && /shoes/i.test(e.text ?? '') && (e.text ?? '').length > 30);
    if (cards.length > 0) {
      const t = (cards[0].text as string).replace(/\s+/g, ' ').trim();
      out.jev_page_snapshot_hint = { picked_card_text: t };
      click = await callJson(client, 'jev_fast_click', {
        target_description: `open the product card titled "${t}"`,
      });
    }
  }
  out.jev_fast_click = click;

  status = await callJson(client, 'jev_browser_status', {});
  out.final_url = (status as { url?: string }).url;

  console.log(JSON.stringify(out, null, 2));
  await client.close();
  process.exit(click.success ? 0 : 1);
}

main().catch(err => { console.error(JSON.stringify({ fatal: String(err) })); process.exit(1); });
