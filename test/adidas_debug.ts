/**
 * test/adidas_debug.ts — one-off diagnostic: snapshot the adidas search
 * listing and print what the heuristic has to choose from around the
 * "Running Shoes" echo vs actual product cards.
 */
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface El {
  id: string; tag: string; role: string;
  text: string | null; ariaLabel: string | null; zone?: string;
}

async function callJson(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  return JSON.parse(text);
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['d:/jev_bridge/build/src/index.js'],
    cwd: 'd:/jev_bridge',
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'jev-debug', version: '1.0.0' });
  await client.connect(transport);

  await callJson(client, 'jev_navigate', { url: 'https://www.adidas.com/us/search?q=running%20shoes' });
  await callJson(client, 'jev_wait', { timeout_ms: 8000 });

  const snap = await callJson(client, 'jev_page_snapshot', {});
  const els: El[] = snap.elements ?? [];
  console.log(`total elements: ${els.length}, url: ${snap.url}`);

  const show = (label: string, pred: (e: El) => boolean) => {
    console.log(`\n── ${label} ──`);
    els.filter(pred).slice(0, 12).forEach(e =>
      console.log(`  [${e.id}] ${e.tag}/${e.role} z=${e.zone} text="${(e.text ?? '').slice(0, 60)}" aria="${(e.ariaLabel ?? '').slice(0, 40)}"`));
  };

  show('elements whose text mentions "running shoes"', e => (e.text ?? '').toLowerCase().includes('running shoes'));
  show('elements mentioning adizero/ultraboost', e => /adizero|ultraboost|gazelle|samba|supernova/i.test((e.text ?? '') + (e.ariaLabel ?? '')));
  show('main-zone links with medium-length text (likely cards)', e => e.zone === 'main' && e.tag === 'A' && (e.text ?? '').length > 10 && (e.text ?? '').length < 80);

  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
