# Installation Guide

This guide explains how to install **AntiParkingLot** (*Prompt Parking Lot*) globally in **Antigravity** so it is available across all workspaces and conversations.

---

## Prerequisites

- **Antigravity** (Desktop App or IDE)
- **Node.js 18+** and **npm** available on your system `PATH` (Antigravity launches the MCP server via `node ${PLUGIN_ROOT}/server/index.mjs`)

---

## Quick Install (Recommended)

Run the included cross-platform installer script from the repository root. It installs dependencies, builds `dist/app.html`, and registers the plugin globally with Antigravity:

```powershell
git clone https://github.com/jmbreckel/AntiParkingLot.git
cd AntiParkingLot
npm run install:global
```

*(You can also run `node scripts/install-global.mjs` directly on a fresh clone before `npm install`.)*

### Installer Options

| Command | Behavior |
| :--- | :--- |
| `npm run install:global` | Default (`--mode=register`): installs dependencies, builds the UI, and adds a zero-copy entry to `~/.gemini/config/plugins.json`. |
| `npm run install:global -- --mode=link` | Creates a directory junction (Windows) or symlink (macOS/Linux) at `~/.gemini/config/plugins/anti-parking-lot`. |
| `npm run install:global -- --mode=copy` | Copies the standalone built plugin (including `node_modules/` and `dist/app.html`) into `~/.gemini/config/plugins/anti-parking-lot`. |
| `npm run install:global -- --skip-install --skip-build` | Skips `npm install` and/or `npm run build` and only updates global registration. |
| `npm run uninstall:global` | Removes the global registration / installed copy while preserving your saved data in `~/.gemini/config/plugin-data/anti-parking-lot/`. |

---

## Manual Installation

If you prefer to set up each step manually instead of using `scripts/install-global.mjs`:

### Step 1: Clone, Install Dependencies & Build

Clone the repository and install its dependencies. `node_modules/` must be present inside the plugin folder at runtime, and `dist/app.html` contains the bundled Side-Pane UI:

```powershell
git clone https://github.com/jmbreckel/AntiParkingLot.git
cd AntiParkingLot
npm install
npm run build
```

*(Optional)* Run the end-to-end verification suite to confirm the MCP server, tools, and UI bundle work locally:

```powershell
npm test
```

---

## Step 2: Register Globally in Antigravity

Antigravity automatically discovers global plugins without requiring a restart. Choose **one** of the two methods below (**do not use both at the same time**, as duplicate plugin names collide):

### Option A: Zero-Copy Registration via `~/.gemini/config/plugins.json` *(Recommended)*

Best if you want to keep the plugin inside your Git working directory so `git pull` updates work in place.

Antigravity scans each `entries[].path` in `plugins.json` **one level deep**, so point `path` at the **parent folder** containing `AntiParkingLot` and use `include_only` to load only this plugin.

#### Windows (`%USERPROFILE%\.gemini\config\plugins.json`)

```json
{
  "entries": [
    {
      "path": "C:/path/to/parent-folder",
      "include_only": ["AntiParkingLot"]
    }
  ]
}
```

#### macOS / Linux (`~/.gemini/config/plugins.json`)

```json
{
  "entries": [
    {
      "path": "/path/to/parent-folder",
      "include_only": ["AntiParkingLot"]
    }
  ]
}
```

> **Note:** If `plugins.json` already exists, append the new object to its existing `"entries"` array rather than overwriting the file. Use forward slashes (`/`) or escaped backslashes (`\\`) in Windows JSON paths.

---

### Option B: Direct Install in `~/.gemini/config/plugins/`

Antigravity automatically discovers any subdirectory placed directly under `~/.gemini/config/plugins/` that contains a `plugin.json`.

#### Option B1: Copy the built plugin folder

Ensure you copy the entire directory **including `node_modules/` and `dist/app.html`**.

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.gemini\config\plugins" | Out-Null
Copy-Item -Recurse -Force ".\AntiParkingLot" "$env:USERPROFILE\.gemini\config\plugins\anti-parking-lot"
```

**macOS / Linux:**
```bash
mkdir -p ~/.gemini/config/plugins
cp -R ./AntiParkingLot ~/.gemini/config/plugins/anti-parking-lot
```

#### Option B2: Symlink / Junction to your clone

If you prefer a direct link without editing `plugins.json`:

**Windows (PowerShell — no admin privileges required for a Junction):**
```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.gemini\config\plugins" | Out-Null
New-Item -ItemType Junction -Path "$env:USERPROFILE\.gemini\config\plugins\anti-parking-lot" -Target "C:\path\to\AntiParkingLot"
```

**macOS / Linux:**
```bash
mkdir -p ~/.gemini/config/plugins
ln -s /path/to/AntiParkingLot ~/.gemini/config/plugins/anti-parking-lot
```

---

## Step 3: Verify Activation

New plugins are picked up automatically by Antigravity:

1. Open **Customizations → Plugins** in Antigravity and confirm **Prompt Parking Lot** (`anti-parking-lot`) appears and is enabled.
2. Open **Parking Lot** from either:
   - The right-hand **Side Pane `+` menu** → **Parking Lot** (docked alongside your active conversation), or
   - The **Left Sidebar** → **Parking Lot** (full-page cross-project view).
3. See the [User Guide](./user-guide.md) or [Instructions](../instruction.md) for day-to-day usage.

---

## Updating

1. Pull the latest changes and rebuild:
   ```powershell
   git pull
   npm install
   npm run build
   ```
   *(If you used Option B1 copy, re-copy the updated folder into `~/.gemini/config/plugins/anti-parking-lot/`.)*
2. Because an already-running MCP server keeps its previous process in memory, restart the `parking-lot` server from Antigravity's **MCP Servers** settings (or toggle the plugin off and back on) to load server-side changes.

---

## Storage Location & Custom Data Directory

Parked ideas and auto-saved drafts are stored locally on disk at:

```text
~/.gemini/config/plugin-data/anti-parking-lot/parking_lot.json
```

Your data lives outside the plugin folder, so updating or reinstalling the plugin preserves all parked items. To use a custom storage directory, set the `PARKING_LOT_DATA_DIR` environment variable or pass `--data-dir=<path>` in `mcp_config.json`.

---

## Uninstalling

1. **Remove global registration:**
   - **Option A:** Remove the `AntiParkingLot` entry from `~/.gemini/config/plugins.json`.
   - **Option B:** Delete `~/.gemini/config/plugins/anti-parking-lot` (for a Windows junction, use `Remove-Item "$env:USERPROFILE\.gemini\config\plugins\anti-parking-lot"`).
2. *(Optional)* Delete `~/.gemini/config/plugin-data/anti-parking-lot/` if you also want to erase your saved parked prompts.

---

## Troubleshooting

| Symptom | Likely Cause & Fix |
| :--- | :--- |
| **Plugin does not appear in Customizations** | Verify `plugins.json` is valid JSON and that `entries[].path` points to the **parent** directory containing `AntiParkingLot/` (not the `AntiParkingLot/` directory itself). Confirm `plugin.json` is at the root of that folder. |
| **MCP server fails to start** | Ensure `node` (v18+) is on your system `PATH` and that `npm install` was run inside the installed plugin folder so `node_modules/` exists alongside `server/index.mjs`. |
| **Side Pane opens blank or shows an error** | Run `npm run build` to verify `dist/app.html` is generated, then restart the MCP server from **MCP Servers** settings. |
| **Duplicate plugin warning or stale version loading** | Make sure the plugin is not registered in **both** `~/.gemini/config/plugins.json` and `~/.gemini/config/plugins/`. |
