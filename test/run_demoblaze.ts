import 'dotenv/config';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const convDir = 'C:/Users/user/.gemini/antigravity/brain/fae4c6f5-1e70-400a-83e7-10347250e5cd';
  const artifactDir = path.resolve(__dirname, '../artifacts');
  for (const d of [convDir, artifactDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['d:/jev_bridge/build/src/index.js'],
  });

  const client = new Client({ name: 'mcp-runner', version: '1.0.0' });
  await client.connect(transport);
  console.log('[MCP Connected]');

  // Step 1: jev_navigate
  console.log('\n=== STEP 1: jev_navigate ===');
  const navRes = await client.callTool({
    name: 'jev_navigate',
    arguments: { url: 'https://www.demoblaze.com/' }
  });
  console.log('NAVIGATE RESULT:', JSON.stringify(navRes, null, 2));

  // Step 2: jev_screenshot
  console.log('\n=== STEP 2: jev_screenshot ===');
  await new Promise(r => setTimeout(r, 2000));
  const ss1Res = await client.callTool({
    name: 'jev_screenshot',
    arguments: { full_page: false }
  });
  const img1 = (ss1Res.content as any[]).find(c => c.type === 'image');
  if (img1 && img1.data) {
    fs.writeFileSync(path.join(convDir, 'step2_screenshot.png'), Buffer.from(img1.data, 'base64'));
    fs.writeFileSync(path.join(artifactDir, 'step2_screenshot.png'), Buffer.from(img1.data, 'base64'));
    console.log('Saved screenshot 1');
  }
  const txt1 = (ss1Res.content as any[]).find(c => c.type === 'text');
  console.log('SCREENSHOT 1 META:', txt1?.text);

  // Step 3: jev_page_snapshot
  console.log('\n=== STEP 3: jev_page_snapshot ===');
  await new Promise(r => setTimeout(r, 1000));
  const snapRes = await client.callTool({
    name: 'jev_page_snapshot',
    arguments: { include_text_nodes: false }
  });
  const txtSnap = (snapRes.content as any[]).find(c => c.type === 'text');
  console.log('SNAPSHOT RESULT:');
  console.log(txtSnap?.text);

  // Step 4: jev_fast_click -> target_description: "the first product in the grid"
  console.log('\n=== STEP 4: jev_fast_click ("the first product in the grid") ===');
  await new Promise(r => setTimeout(r, 2000));
  const click1Res = await client.callTool({
    name: 'jev_fast_click',
    arguments: { target_description: 'the first product in the grid' }
  });
  console.log('CLICK 1 RESULT:', JSON.stringify(click1Res, null, 2));

  // Step 5: jev_screenshot
  console.log('\n=== STEP 5: jev_screenshot ===');
  await new Promise(r => setTimeout(r, 2000));
  const ss2Res = await client.callTool({
    name: 'jev_screenshot',
    arguments: { full_page: false }
  });
  const img2 = (ss2Res.content as any[]).find(c => c.type === 'image');
  if (img2 && img2.data) {
    fs.writeFileSync(path.join(convDir, 'step5_screenshot.png'), Buffer.from(img2.data, 'base64'));
    fs.writeFileSync(path.join(artifactDir, 'step5_screenshot.png'), Buffer.from(img2.data, 'base64'));
    console.log('Saved screenshot 2');
  }
  const txt2 = (ss2Res.content as any[]).find(c => c.type === 'text');
  console.log('SCREENSHOT 2 META:', txt2?.text);

  // Step 6: jev_fast_click -> target_description: "Add to cart button"
  console.log('\n=== STEP 6: jev_fast_click ("Add to cart button") ===');
  await new Promise(r => setTimeout(r, 2000));
  const click2Res = await client.callTool({
    name: 'jev_fast_click',
    arguments: { target_description: 'Add to cart button' }
  });
  console.log('CLICK 2 RESULT:', JSON.stringify(click2Res, null, 2));

  // Step 7: jev_screenshot
  console.log('\n=== STEP 7: jev_screenshot ===');
  await new Promise(r => setTimeout(r, 2000));
  const ss3Res = await client.callTool({
    name: 'jev_screenshot',
    arguments: { full_page: false }
  });
  const img3 = (ss3Res.content as any[]).find(c => c.type === 'image');
  if (img3 && img3.data) {
    fs.writeFileSync(path.join(convDir, 'step7_screenshot.png'), Buffer.from(img3.data, 'base64'));
    fs.writeFileSync(path.join(artifactDir, 'step7_screenshot.png'), Buffer.from(img3.data, 'base64'));
    console.log('Saved screenshot 3');
  }
  const txt3 = (ss3Res.content as any[]).find(c => c.type === 'text');
  console.log('SCREENSHOT 3 META:', txt3?.text);

  console.log('\n=== ALL STEPS COMPLETED SUCCESSFULLY ===');
  console.log('Leaving Chrome open on screen for user inspection...');
  // Keep process running so Chrome stays visible on screen for user
  await new Promise(r => setTimeout(r, 600000));
}

run().catch(e => {
  console.error('RUNNER FAILED:', e);
  process.exit(1);
});
