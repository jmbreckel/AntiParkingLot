# MCP & Storage Reference

Technical specification for the `AntiParkingLot` MCP server (`server/index.mjs`), voice dictation engine (`server/voice.mjs`), UI resource (`ui://parking-lot/app.html`), and persistent JSON store (`server/store.mjs`).

---

## 1. Registered MCP Server Identity

- **Plugin Name (`plugin.json`):** `anti-parking-lot`
- **Plugin Directory Name:** `AntiParkingLot`
- **Local Server Key (`mcp_config.json`):** `parking-lot`
- **Antigravity Namespaced Server Name:** `AntiParkingLot_parking-lot`
- **Transport:** JSON-RPC 2.0 over `stdio`

---


## 2. UI Resource (`ui://parking-lot/app.html`)

- **MIME Type:** `text/html;profile=mcp-app`
- **Resource `_meta`:**
  ```json
  {
    "ui": {
      "prefersBorder": false,
      "permissions": {
        "microphone": {},
        "clipboardWrite": {}
      }
    }
  }
  ```

---

## 3. Model & Host Tools

These tools are visible to Antigravity and the host UI:

### `open_parking_lot`

Opens or refreshes the interactive **Parking Lot** UI in the Side Pane (`aux_pane`) or Left Sidebar (`global`).

- **Arguments:** `project` _(string, optional)_, `status` _(`"parked"` | `"done"` | `"all"`, optional)_, `search` _(string, optional)_.

### `park_prompt`

Saves a follow-up idea or prompt from chat and renders an inline Parking Lot preview.

- **Arguments:** `prompt` _(string, **required**)_, `project`, `priority` _(`"high"` | `"normal"` | `"low"`)_, `notes`, `tags` _(string[])_, `pinned` _(boolean)_, `screenshots` _(string[], optional local image file paths copied into `screenshots/`)_.

### `list_parked_prompts`

Returns a Markdown summary (including attached screenshot file paths) and structured snapshot of parked ideas without opening a UI frame.

### `complete_parked_prompt`

Marks an item `"done"` or reopens it back to `"parked"` by `id`.

### `delete_parked_prompt`

Deletes a single item by `id` or clears all completed items (`clearDone: true`).

---

## 4. App-Only UI, Voice & Screenshot Tools (`visibility: ["app"]`)

Declared with `_meta: { ui: { visibility: ["app"] } }`. Hidden from the LLM context window and invoked directly by `dist/app.html` via `app.callServerTool(...)` so UI, screenshot, and microphone interactions never interrupt active agent turns:

| Tool Name               | Arguments                                                                                         | Purpose                                                                                                                  |
| :---------------------- | :------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------- |
| `app_get_state`         | `{}`                                                                                              | Fetches full sorted snapshot (`allItems`, `projects`, `stats`, `draft`).                                                 |
| `app_save_draft`        | `{ prompt?, notes?, project?, priority?, pinned?, screenshots? }`                                 | Debounced (450 ms) auto-save of unsent composer text and attached screenshots.                                           |
| `app_save_item`         | `{ id?, prompt?, title?, project?, priority?, notes?, tags?, pinned?, screenshots?, clearDraft? }` | Creates a new parked idea (clearing saved draft) or updates an existing card inline.                                     |
| `app_set_status`        | `{ id?, ids?, status?, pinned?, incrementLaunch? }`                                               | Single or batch status/pin toggle and launch counter increment.                                                          |
| `app_reorder_item`      | `{ id, direction: "up" \| "down" }`                                                               | Moves a parked card up or down and normalizes `sortOrder`.                                                               |
| `app_delete_item`       | `{ id?, ids?, clearDone? }`                                                                       | Deletes one item, a batch of items, or all completed items (and cleans up unreferenced screenshot files).                |
| `app_upload_screenshot` | `{ dataUrl, name?, width?, height?, thumbDataUrl? }`                                              | Decodes and writes a pasted/dropped/selected image to `screenshots/` (up to 15 MB) and returns metadata.                 |
| `app_get_screenshot`    | `{ id }`                                                                                          | Reads a full-resolution screenshot from `screenshots/` as a `data:` URL for Lightbox preview.                            |
| `app_delete_screenshot` | `{ id }`                                                                                          | Removes an unsent screenshot from `draft` and deletes its disk file if unreferenced.                                     |
| `app_voice_start`       | `{}`                                                                                              | Starts host-side microphone speech-to-text recognition (`WinRT SpeechRecognizer` with offline `System.Speech` fallback). |
| `app_voice_poll`        | `{ cursor? }`                                                                                     | Returns newly finalized speech segments since `cursor` plus live partial hypothesis text.                                |
| `app_voice_stop`        | `{ cursor? }`                                                                                     | Stops active speech recognition cleanly and flushes any final recognized text.                                           |

---

## 5. Storage Schema (`parking_lot.json` + `screenshots/`)

Default path: `~/.gemini/config/plugin-data/anti-parking-lot/parking_lot.json` and `screenshots/` directory (override via `--data-dir=<path>` or `PARKING_LOT_DATA_DIR`).

```json
{
  "version": 1,
  "draft": {
    "prompt": "Unfinished dictated or typed thought...",
    "notes": "catalog/opds.py",
    "project": "MyLibrary",
    "priority": "normal",
    "pinned": false,
    "screenshots": [],
    "updatedAt": "2026-11-25T16:00:00.000Z"
  },
  "items": [
    {
      "id": "pl_a1b2c3d4",
      "title": "Add publisher filter pill to detail modal",
      "prompt": "Add publisher filter pill to detail modal so clicking Publisher searches matching books.",
      "notes": "catalog/opds.py + catalog/static/js/search.js",
      "project": "MyLibrary",
      "priority": "high",
      "tags": ["ui", "search"],
      "pinned": true,
      "screenshots": [
        {
          "id": "ss_9f8e7d6c5b",
          "filename": "ss_9f8e7d6c5b.png",
          "filePath": "C:\\Users\\user\\.gemini\\config\\plugin-data\\anti-parking-lot\\screenshots\\ss_9f8e7d6c5b.png",
          "mimeType": "image/png",
          "name": "detail-modal-snip.png",
          "sizeBytes": 84210,
          "width": 1280,
          "height": 720,
          "thumbDataUrl": "data:image/webp;base64,...",
          "createdAt": "2026-11-25T15:54:50.000Z"
        }
      ],
      "status": "parked",
      "sortOrder": 10,
      "launchCount": 0,
      "lastLaunchedAt": null,
      "createdAt": "2026-11-25T15:55:00.000Z",
      "updatedAt": "2026-11-25T15:55:00.000Z",
      "completedAt": null
    }
  ]
}
```
