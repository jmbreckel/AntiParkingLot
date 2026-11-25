#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ParkingLotStore } from './store.mjs';
import { VoiceDictationManager } from './voice.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_HTML_PATH = path.join(ROOT_DIR, 'dist', 'app.html');

function resolveDataDir() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--data-dir=') || arg.startsWith('--data_dir=')) {
      const val = arg.split('=', 2)[1]?.trim();
      if (val && !val.includes('${')) {
        return val;
      }
    }
  }
  if (process.env.PARKING_LOT_DATA_DIR) {
    return process.env.PARKING_LOT_DATA_DIR;
  }
  return path.join(os.homedir(), '.gemini', 'config', 'plugin-data', 'anti-parking-lot');
}

const store = new ParkingLotStore(resolveDataDir());
const voice = new VoiceDictationManager();

const APP_URI = 'ui://parking-lot/app.html';

const RESOURCE_UI_META = {
  ui: {
    prefersBorder: false,
    permissions: {
      microphone: {},
      clipboardWrite: {},
    },
  },
};

const INLINE_META = {
  ui: { resourceUri: APP_URI },
};

const PANE_META = {
  ui: { resourceUri: APP_URI },
  'com.google.antigravity/ui': {
    entrypoints: [
      { type: 'aux_pane', title: 'Parking Lot' },
      { type: 'global', title: 'Parking Lot' },
    ],
  },
};

const APP_ONLY_META = {
  ui: { visibility: ['app'] },
};

function formatMarkdownSummary(snap, heading = 'Prompt Parking Lot') {
  const { items, stats } = snap;
  if (!items.length) {
    return `### ${heading}\nNo parked ideas match (${stats.parked} parked, ${stats.done} done total).`;
  }
  const lines = [`### ${heading} (${stats.parked} parked · ${stats.done} done)`];
  items.forEach((it, idx) => {
    const ssCount = Array.isArray(it.screenshots) ? it.screenshots.length : 0;
    const flags = [
      it.status === 'done' ? '✓ DONE' : null,
      it.pinned ? '📌 Pinned' : null,
      it.priority === 'high' ? '🔥 High' : it.priority === 'low' ? '🧊 Low' : null,
      it.project ? `📁 ${it.project}` : null,
      ssCount > 0 ? `📷 ${ssCount} screenshot${ssCount === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    const metaSuffix = flags.length ? ` [${flags.join(' · ')}]` : '';
    const ssLines =
      ssCount > 0
        ? it.screenshots.map((s) => `\n   - *Screenshot:* \`${s.filePath}\``).join('')
        : '';
    lines.push(`${idx + 1}. **\`${it.id}\`**${metaSuffix}: ${it.prompt}${it.notes ? `\n   - *Note:* ${it.notes}` : ''}${ssLines}`);
  });
  return lines.join('\n');
}

const TOOLS = [
  {
    name: 'open_parking_lot',
    title: 'Parking Lot',
    description:
      'Open or refresh the interactive Prompt Parking Lot panel in the side pane (or left sidebar) where the user can type or voice-dictate ideas while Antigravity is working and send them when ready.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Optional workspace or project name to filter by.',
        },
        status: {
          type: 'string',
          enum: ['parked', 'done', 'all'],
          description: 'Optional tab filter (defaults to parked).',
        },
        search: {
          type: 'string',
          description: 'Optional search substring.',
        },
      },
    },
    _meta: PANE_META,
  },
  {
    name: 'park_prompt',
    title: 'Park an Idea',
    description:
      'Save a follow-up idea or prompt into the persistent Prompt Parking Lot so the user does not forget it and can send it later when ready.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The idea or prompt text to park for later.',
        },
        project: {
          type: 'string',
          description: 'Optional workspace/project tag (e.g. MyLibrary).',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: 'Priority level (high, normal, or low).',
        },
        notes: {
          type: 'string',
          description: 'Optional context note (such as relevant file paths or reminders).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional topic tags.',
        },
        pinned: {
          type: 'boolean',
          description: 'Pin this idea to the top of the Parking Lot.',
        },
        screenshots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional local image file paths on disk to attach as screenshots.',
        },
      },
      required: ['prompt'],
    },
    _meta: INLINE_META,
  },
  {
    name: 'list_parked_prompts',
    title: 'List Parked Ideas',
    description: 'List ideas and prompts stored in the Prompt Parking Lot, optionally filtered by status, project, priority, or keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['parked', 'done', 'all'],
          description: 'Filter by status (defaults to parked).',
        },
        project: {
          type: 'string',
          description: 'Optional project/workspace filter.',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: 'Optional priority filter.',
        },
        search: {
          type: 'string',
          description: 'Optional search keyword.',
        },
      },
    },
  },
  {
    name: 'complete_parked_prompt',
    title: 'Complete or Reopen Parked Idea',
    description: 'Mark a parked idea as done (or reopen it back to parked) by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The parked idea ID (e.g. pl_a1b2c3d4).',
        },
        status: {
          type: 'string',
          enum: ['done', 'parked'],
          description: 'Target status (defaults to done).',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_parked_prompt',
    title: 'Delete Parked Idea',
    description: 'Delete a parked idea by ID, or clear all completed ideas.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Parked idea ID to remove.',
        },
        clearDone: {
          type: 'boolean',
          description: 'Set true to remove all completed (done) items.',
        },
      },
    },
  },
  // App-only UI mutation & voice tools (hidden from model, zero agent interruption)
  {
    name: 'app_get_state',
    description: 'Internal UI state fetch.',
    inputSchema: { type: 'object', properties: {} },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_save_draft',
    description: 'Internal UI auto-save unsent composer draft.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        notes: { type: 'string' },
        project: { type: 'string' },
        priority: { type: 'string' },
        pinned: { type: 'boolean' },
        screenshots: { type: 'array', items: { type: 'object' } },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_save_item',
    description: 'Internal UI create/update parked idea.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        prompt: { type: 'string' },
        title: { type: 'string' },
        project: { type: 'string' },
        priority: { type: 'string' },
        notes: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        pinned: { type: 'boolean' },
        screenshots: { type: 'array', items: { type: 'object' } },
        clearDraft: { type: 'boolean' },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_upload_screenshot',
    description: 'Internal UI save pasted/dropped/uploaded screenshot image to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        dataUrl: { type: 'string' },
        name: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        thumbDataUrl: { type: 'string' },
      },
      required: ['dataUrl'],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_get_screenshot',
    description: 'Internal UI load full-resolution screenshot image data URL by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_delete_screenshot',
    description: 'Internal UI delete unreferenced draft screenshot by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_set_status',
    description: 'Internal UI status/pin toggle (single id or batch ids).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
        status: { type: 'string' },
        pinned: { type: 'boolean' },
        incrementLaunch: { type: 'boolean' },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_reorder_item',
    description: 'Internal UI reorder up/down.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        direction: { type: 'string', enum: ['up', 'down'] },
      },
      required: ['id', 'direction'],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_delete_item',
    description: 'Internal UI delete single/batch or clear done.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
        clearDone: { type: 'boolean' },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_voice_start',
    description: 'Internal UI start host microphone speech-to-text session.',
    inputSchema: { type: 'object', properties: {} },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_voice_poll',
    description: 'Internal UI poll live recognized speech segments and hypotheses.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { type: 'number' },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: 'app_voice_stop',
    description: 'Internal UI stop host microphone speech-to-text session and flush final text.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { type: 'number' },
      },
    },
    _meta: APP_ONLY_META,
  },
];

const server = new Server(
  {
    name: 'anti-parking-lot',
    version: '1.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: APP_URI,
        name: 'Prompt Parking Lot UI',
        description: 'Interactive Side-Pane and Sidebar UI for Prompt Parking Lot with Voice Dictation',
        mimeType: 'text/html;profile=mcp-app',
        _meta: RESOURCE_UI_META,
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri !== APP_URI) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }
  const htmlPath = process.env.PARKING_LOT_APP_HTML || DEFAULT_HTML_PATH;
  const html = fs.readFileSync(htmlPath, 'utf8');
  return {
    contents: [
      {
        uri: APP_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: html,
        _meta: RESOURCE_UI_META,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    if (name === 'open_parking_lot') {
      const snap = store.getSnapshot({
        status: args.status || 'parked',
        project: args.project || '',
        search: args.search || '',
      });
      return {
        content: [{ type: 'text', text: formatMarkdownSummary(snap, 'Prompt Parking Lot Opened') }],
        structuredContent: snap,
      };
    }

    if (name === 'park_prompt') {
      const saved = store.saveItem(args);
      const snap = store.getSnapshot({ status: 'parked', project: args.project || '' });
      const ssCount = Array.isArray(saved.screenshots) ? saved.screenshots.length : 0;
      const ssNote = ssCount > 0 ? ` [${ssCount} screenshot${ssCount === 1 ? '' : 's'} attached]` : '';
      return {
        content: [
          {
            type: 'text',
            text: `Parked idea **\`${saved.id}\`**${saved.project ? ` under **${saved.project}**` : ''} (${saved.priority} priority)${ssNote}:\n> ${saved.prompt}`,
          },
        ],
        structuredContent: { ...snap, lastSaved: saved },
      };
    }

    if (name === 'list_parked_prompts') {
      const snap = store.getSnapshot({
        status: args.status || 'parked',
        project: args.project || '',
        priority: args.priority || '',
        search: args.search || '',
      });
      return {
        content: [{ type: 'text', text: formatMarkdownSummary(snap) }],
        structuredContent: snap,
      };
    }

    if (name === 'complete_parked_prompt') {
      const updated = store.updateStatus(args.id, { status: args.status || 'done' });
      const snap = store.getSnapshot({ status: 'parked' });
      return {
        content: [
          {
            type: 'text',
            text: `Marked **\`${updated.id}\`** as **${updated.status}**: ${updated.title}`,
          },
        ],
        structuredContent: snap,
      };
    }

    if (name === 'delete_parked_prompt') {
      const res = store.deleteItem({ id: args.id, clearDone: Boolean(args.clearDone) });
      const snap = store.getSnapshot({ status: 'parked' });
      return {
        content: [{ type: 'text', text: `Removed ${res.removedCount} item(s) from Parking Lot.` }],
        structuredContent: snap,
      };
    }

    // App-only handlers (UI <-> MCP Server directly, zero agent interruption)
    if (name === 'app_get_state') {
      const snap = store.getSnapshot({ status: 'all' });
      return {
        content: [{ type: 'text', text: 'OK' }],
        structuredContent: snap,
      };
    }

    if (name === 'app_save_draft') {
      const draft = store.saveDraft(args);
      return {
        content: [{ type: 'text', text: 'Draft saved' }],
        structuredContent: { isVoiceOrDraft: true, draftSaved: true, draft },
      };
    }

    if (name === 'app_save_item') {
      const saved = store.saveItem(args);
      const snap = store.getSnapshot({ status: 'all' });
      return {
        content: [{ type: 'text', text: `Saved ${saved.id}` }],
        structuredContent: { ...snap, lastSaved: saved },
      };
    }

    if (name === 'app_upload_screenshot') {
      const screenshot = store.saveScreenshot(args);
      return {
        content: [{ type: 'text', text: `Uploaded ${screenshot.id}` }],
        structuredContent: { isVoiceOrDraft: true, screenshot },
      };
    }

    if (name === 'app_get_screenshot') {
      const screenshot = store.getScreenshotDataUrl(args.id);
      return {
        content: [{ type: 'text', text: 'OK' }],
        structuredContent: { isVoiceOrDraft: true, screenshot },
      };
    }

    if (name === 'app_delete_screenshot') {
      const res = store.deleteScreenshot(args.id);
      return {
        content: [{ type: 'text', text: 'Deleted screenshot' }],
        structuredContent: { isVoiceOrDraft: true, ...res },
      };
    }

    if (name === 'app_set_status') {
      const target = Array.isArray(args.ids) && args.ids.length > 0 ? args.ids : args.id;
      store.updateStatus(target, {
        status: args.status,
        pinned: args.pinned,
        incrementLaunch: Boolean(args.incrementLaunch),
      });
      const snap = store.getSnapshot({ status: 'all' });
      return {
        content: [{ type: 'text', text: 'Updated' }],
        structuredContent: snap,
      };
    }

    if (name === 'app_reorder_item') {
      store.moveItem(args.id, args.direction);
      const snap = store.getSnapshot({ status: 'all' });
      return {
        content: [{ type: 'text', text: 'Reordered' }],
        structuredContent: snap,
      };
    }

    if (name === 'app_delete_item') {
      store.deleteItem({ id: args.id, ids: args.ids, clearDone: Boolean(args.clearDone) });
      const snap = store.getSnapshot({ status: 'all' });
      return {
        content: [{ type: 'text', text: 'Deleted' }],
        structuredContent: snap,
      };
    }

    // Voice-to-text handlers
    if (name === 'app_voice_start') {
      const voiceState = voice.start();
      return {
        content: [{ type: 'text', text: 'Voice started' }],
        structuredContent: { isVoiceOrDraft: true, voice: voiceState },
      };
    }

    if (name === 'app_voice_poll') {
      const voiceState = voice.poll(args.cursor ?? 0);
      return {
        content: [{ type: 'text', text: 'Voice poll' }],
        structuredContent: { isVoiceOrDraft: true, voice: voiceState },
      };
    }

    if (name === 'app_voice_stop') {
      const voiceState = await voice.stop(args.cursor ?? 0);
      return {
        content: [{ type: 'text', text: 'Voice stopped' }],
        structuredContent: { isVoiceOrDraft: true, voice: voiceState },
      };
    }

    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }],
    };
  }
});

process.on('exit', () => {
  voice.stop().catch(() => {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
