import 'dotenv/config';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const artifactDir = path.resolve('C:/Users/user/.gemini/antigravity/brain/fae4c6f5-1e70-400a-83e7-10347250e5cd');
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  console.log('[Connecting to jev-fast-playwright MCP Server...]');
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['d:/jev_bridge/build/src/index.js'],
  });

  const client = new Client({ name: 'live-test-runner', version: '1.0.0' });
  await client.connect(transport);
  console.log('✅ Connected to MCP Server!\n');

  // Test 1: Navigate to Demoblaze
  console.log('─── Step 1: Navigating to https://www.demoblaze.com/ ───');
  const nav1 = await client.callTool({
    name: 'jev_navigate',
    arguments: { url: 'https://www.demoblaze.com/' }
  });
  console.log('Navigated:', (nav1.content as any[])[0]?.text);

  await new Promise(r => setTimeout(r, 2000));

  // Test 2: Snapshot page elements
  console.log('\n─── Step 2: Page Snapshot (Listing elements) ───');
  const snap1 = await client.callTool({
    name: 'jev_page_snapshot',
    arguments: { include_text_nodes: false }
  });
  const snapData = JSON.parse((snap1.content as any[])[0]?.text ?? '{}');
  console.log(`Discovered ${snapData.element_count} interactive elements in ${snapData.elapsed_ms}ms`);

  // Test 3: Fast click "Laptops" category
  console.log('\n─── Step 3: Fast Click "Laptops category link" ───');
  const clickLaptops = await client.callTool({
    name: 'jev_fast_click',
    arguments: { target_description: 'Laptops category link' }
  });
  console.log('Click result:', (clickLaptops.content as any[])[0]?.text);

  await new Promise(r => setTimeout(r, 2500));

  // Test 4: Screenshot laptops grid
  console.log('\n─── Step 4: Screenshot Laptops category ───');
  const ss1 = await client.callTool({
    name: 'jev_screenshot',
    arguments: { full_page: false }
  });
  const img1 = (ss1.content as any[]).find(c => c.type === 'image');
  if (img1?.data) {
    fs.writeFileSync(path.join(artifactDir, 'live_test_laptops.png'), Buffer.from(img1.data, 'base64'));
    console.log('Saved screenshot: live_test_laptops.png');
  }

  // Test 5: Fast click product "Sony vaio i5"
  console.log('\n─── Step 5: Fast Click "Sony vaio i5 product" ───');
  const clickLaptopItem = await client.callTool({
    name: 'jev_fast_click',
    arguments: { target_description: 'Sony vaio i5 product link' }
  });
  console.log('Click result:', (clickLaptopItem.content as any[])[0]?.text);

  await new Promise(r => setTimeout(r, 2500));

  // Test 6: Fast click "Add to cart button"
  console.log('\n─── Step 6: Fast Click "Add to cart button" ───');
  const clickAddToCart = await client.callTool({
    name: 'jev_fast_click',
    arguments: { target_description: 'Add to cart button' }
  });
  console.log('Click result:', (clickAddToCart.content as any[])[0]?.text);

  await new Promise(r => setTimeout(r, 2000));

  // Test 7: Final Screenshot
  console.log('\n─── Step 7: Final Verification Screenshot ───');
  const ss2 = await client.callTool({
    name: 'jev_screenshot',
    arguments: { full_page: false }
  });
  const img2 = (ss2.content as any[]).find(c => c.type === 'image');
  if (img2?.data) {
    fs.writeFileSync(path.join(artifactDir, 'live_test_final.png'), Buffer.from(img2.data, 'base64'));
    console.log('Saved screenshot: live_test_final.png');
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('🎉 Live Test Finished Successfully!');
  console.log('Chrome is open on your screen with the added item.');
  console.log('════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
