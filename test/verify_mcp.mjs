import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.resolve(__dirname, '..', 'server', 'index.mjs');
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-parking-lot-test-'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverScript, `--data-dir=${tempDataDir}`],
});

const client = new Client({ name: 'parking-lot-verifier', version: '1.1.0' }, { capabilities: {} });

try {
  await client.connect(transport);

  // 1. Verify tools (including voice tools) and side-pane/global entrypoints
  const { tools } = await client.listTools();
  const openTool = tools.find((t) => t.name === 'open_parking_lot');
  assert.ok(openTool, 'open_parking_lot tool must exist');
  assert.equal(openTool._meta?.ui?.resourceUri, 'ui://parking-lot/app.html');
  assert.deepEqual(
    openTool._meta?.['com.google.antigravity/ui']?.entrypoints?.map((e) => e.type),
    ['aux_pane', 'global']
  );
  for (const appTool of ['app_voice_start', 'app_voice_poll', 'app_voice_stop', 'app_upload_screenshot', 'app_get_screenshot', 'app_delete_screenshot']) {
    const vt = tools.find((t) => t.name === appTool);
    assert.ok(vt, `${appTool} must exist`);
    assert.deepEqual(vt._meta?.ui?.visibility, ['app']);
  }

  // 2. Verify bundled HTML resource & microphone permissions metadata
  const { resources } = await client.listResources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].uri, 'ui://parking-lot/app.html');
  assert.ok(resources[0]._meta?.ui?.permissions?.microphone, 'Resource should declare microphone permission');

  const readRes = await client.readResource({ uri: 'ui://parking-lot/app.html' });
  assert.ok(readRes.contents[0].text.includes('btn-voice'), 'Bundled app.html should contain Voice button');
  assert.ok(readRes.contents[0].text.includes('btn-screenshot'), 'Bundled app.html should contain Image button');
  assert.ok(readRes.contents[0].text.includes('btn-help'), 'Bundled app.html should contain Help button');
  assert.ok(readRes.contents[0].text.includes('help-modal'), 'Bundled app.html should contain Help modal');
  assert.ok(readRes.contents[0].text.length > 50000, 'Bundled app.html should contain esbuild bundle');

  // 3. Verify screenshot upload, draft auto-save, full retrieval & automatic cleanup on delete
  const samplePngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const uploadedRes = await client.callTool({
    name: 'app_upload_screenshot',
    arguments: {
      dataUrl: samplePngDataUrl,
      name: 'bug-snip.png',
      width: 1,
      height: 1,
    },
  });
  const uploadedSs = uploadedRes.structuredContent.screenshot;
  assert.ok(uploadedSs?.id?.startsWith('ss_'), 'Uploaded screenshot should return ss_ ID');
  assert.ok(fs.existsSync(uploadedSs.filePath), 'Uploaded screenshot file should exist on disk');

  const fullSsRes = await client.callTool({
    name: 'app_get_screenshot',
    arguments: { id: uploadedSs.id },
  });
  assert.equal(fullSsRes.structuredContent.screenshot.dataUrl, samplePngDataUrl);

  await client.callTool({
    name: 'app_save_draft',
    arguments: {
      prompt: 'Voice dictated idea while agent runs',
      project: 'MyLibrary',
      priority: 'high',
      screenshots: [uploadedSs],
    },
  });
  const stateWithDraft = await client.callTool({ name: 'app_get_state', arguments: {} });
  assert.equal(stateWithDraft.structuredContent.draft?.prompt, 'Voice dictated idea while agent runs');
  assert.equal(stateWithDraft.structuredContent.draft?.screenshots?.length, 1);

  // 4. Verify parking ideas with screenshots (UI app_save_item clears draft; chat park_prompt adds second item)
  const firstRes = await client.callTool({
    name: 'app_save_item',
    arguments: {
      prompt: 'Check publisher display on detail modal',
      project: 'MyLibrary',
      priority: 'high',
      notes: 'catalog/opds.py',
      screenshots: [uploadedSs],
      clearDraft: true,
    },
  });
  assert.equal(firstRes.structuredContent.draft, null, 'Draft should clear on submit');
  const firstId = firstRes.structuredContent.lastSaved.id;
  assert.equal(firstRes.structuredContent.lastSaved.screenshots?.length, 1);
  assert.ok(fs.existsSync(uploadedSs.filePath), 'Screenshot file must persist when moved from draft to item');

  const listRes = await client.callTool({
    name: 'list_parked_prompts',
    arguments: { status: 'parked' },
  });
  assert.ok(listRes.content[0].text.includes(uploadedSs.filePath), 'Markdown summary should expose screenshot filePath');

  const secondRes = await client.callTool({
    name: 'park_prompt',
    arguments: {
      prompt: 'Add keyboard shortcut cheatsheet',
      project: 'AntiParkingLot',
      priority: 'normal',
    },
  });
  const secondId = secondRes.structuredContent.lastSaved.id;
  assert.equal(secondRes.structuredContent.stats.parked, 2);

  // 5. Verify reorder & batch status update
  await client.callTool({
    name: 'app_reorder_item',
    arguments: { id: secondId, direction: 'up' },
  });
  const batchDone = await client.callTool({
    name: 'app_set_status',
    arguments: { ids: [firstId, secondId], status: 'done', incrementLaunch: true },
  });
  assert.equal(batchDone.structuredContent.stats.parked, 0);
  assert.equal(batchDone.structuredContent.stats.done, 2);

  // 6. Verify clearDone & automatic screenshot file cleanup
  const cleared = await client.callTool({
    name: 'delete_parked_prompt',
    arguments: { clearDone: true },
  });
  assert.equal(cleared.structuredContent.stats.total, 0);
  assert.equal(fs.existsSync(uploadedSs.filePath), false, 'Deleted item screenshot file should be cleaned up from disk');

  console.log('ALL_CHECKS_PASSED', { toolCount: tools.length, htmlBytes: readRes.contents[0].text.length });
} finally {
  await client.close();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}
