# AntiParkingLot — Prompt Parking Lot for Antigravity

An Antigravity **Plugin + Side-Pane MCP App** designed for one core workflow: **type or voice-dictate ideas while Antigravity is busy working without interrupting the active run, then send them when you're ready.**

![System Architecture](./documentation/diagrams/01-system-architecture.png)

## Quick Install (Global on Antigravity)

Requires **Node.js 18+** and **Antigravity**.

```powershell
git clone https://github.com/jmbreckel/AnitParkingLot.git AntiParkingLot
cd AntiParkingLot
npm run install:global
```

`npm run install:global` installs dependencies, builds `dist/app.html`, and registers the plugin globally in `~/.gemini/config/plugins.json` (no Antigravity restart required). Once installed, open **Parking Lot** from the right-hand **Side Pane `+` menu** or the **Left Sidebar** in any workspace.

See the **[Installation Guide](./documentation/installation.md)** for alternative install modes (`--mode=link`, `--mode=copy`), manual setup, updating, uninstalling (`npm run uninstall:global`), and troubleshooting.

## Quick Highlights

1. **Zero-Interruption Side Pane (`+` → Parking Lot):**
   - Open **Parking Lot** from the right-hand **Side Pane `+` menu** or **Left Sidebar** anytime—even mid-run while Antigravity is working.
   - Type or click **🎤 Voice** (`Alt+V`, or `Win+H`) to convert speech to text right inside the Parking Lot composer.
   - Clicking **+ Park Idea** (`Ctrl+Enter`) persists directly to `~/.gemini/config/plugin-data/anti-parking-lot/parking_lot.json` without interrupting or queueing messages on the active agent.
   - Unsent composer text auto-saves locally (450 ms debounce) so switching tabs never loses a half-typed or half-spoken thought.

2. **Send When Ready (Single or Combined):**
   - **▶ Send Here** — Sends the parked idea straight into your current conversation once Antigravity is ready.
   - **↗ New Chat** — Spins off a brand-new conversation in the current project immediately—even while your current chat is still busy.
   - **📎 Attach** — Attaches parked ideas as context to your next message.
   - **Batch Combine** — Check multiple parked ideas to merge and send them together as a numbered prompt (`▶ Send (N)` / `↗ New Chat (N)`).

## Documentation

Full guides and `4x` resolution architectural/workflow diagrams (`.mmd` + `.png`) are available in **[`/documentation`](./documentation/README.md)**:

- **[Installation Guide](./documentation/installation.md)**
- **[Instructions & Conversation Workflow (`instruction.md`)](./instruction.md)**
- **[Documentation Index & Diagram Gallery](./documentation/README.md)**
- **[User Guide](./documentation/user-guide.md)**
- **[Architecture & Design](./documentation/architecture.md)**
- **[MCP & Storage Reference](./documentation/mcp-reference.md)**

## Project Layout

```text
AntiParkingLot/
├── plugin.json                  # Antigravity plugin manifest
├── mcp_config.json              # Launches Node.js MCP App server
├── assets/logo.svg              # Square plugin icon
├── documentation/               # Guides + Mermaid (.mmd) & 4x PNG diagrams
│   ├── README.md
│   ├── installation.md
│   ├── architecture.md
│   ├── user-guide.md
│   ├── mcp-reference.md
│   └── diagrams/
├── server/
│   ├── index.mjs                # MCP server (tools + ui://parking-lot/app.html resource)
│   ├── store.mjs                # Atomic JSON persistence + draft auto-save
│   └── voice.mjs                # Native Windows neural/offline speech-to-text engine
├── ui/
│   ├── template.html            # Host-themed Side-Pane HTML/CSS shell
│   └── app.js                   # @modelcontextprotocol/ext-apps client + voice controls
├── dist/app.html                # Bundled single-file MCP App UI
├── scripts/
│   ├── build.mjs                # esbuild single-file UI bundler
│   ├── install-global.mjs       # Cross-platform global Antigravity installer
│   └── render-diagrams.mjs      # Headless 4x resolution Mermaid-to-PNG renderer
├── test/verify_mcp.mjs          # End-to-end MCP server, voice metadata & UI test
└── skills/parking-lot/SKILL.md  # Optional chat workflow instructions
```

## Development & Scripts

```powershell
npm install              # Install runtime and build dependencies
npm run build            # Bundle ui/ into dist/app.html
npm run build:diagrams   # Re-render 4x PNG diagrams from documentation/diagrams/*.mmd
npm test                 # Run end-to-end MCP server, voice metadata & UI verification
npm run install:global   # Build and register globally in Antigravity
npm run uninstall:global # Remove global registration (preserves saved ideas)
```

## Contributing & License

- Contributions, bug reports, and feature requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and [CHANGELOG.md](./CHANGELOG.md).
- Licensed under the [MIT License](./LICENSE).
