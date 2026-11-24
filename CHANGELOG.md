# Changelog

All notable changes to **AntiParkingLot** (*Prompt Parking Lot*) are documented in this file.

## [1.0.0] - 2026-11-24

### Added
- Antigravity Plugin + Side-Pane (`aux_pane`) and Left Sidebar (`global`) MCP App UI (`ui://parking-lot/app.html`).
- Zero-interruption idea capture with 450 ms auto-saved drafts and atomic JSON storage (`~/.gemini/config/plugin-data/anti-parking-lot/parking_lot.json`).
- Native voice-to-text dictation (`WinRT SpeechRecognizer` with offline `System.Speech` fallback on Windows, Web Speech API fallback on macOS/Linux).
- Single and batch prompt actions: **Send Here**, **New Chat**, **Attach**, **Copy**, priority tags, pinning, manual reorder, search, and project filtering.
- Cross-platform global installer (`npm run install:global` / `npm run uninstall:global`) supporting `--mode=register`, `--mode=link`, and `--mode=copy`.
- Full documentation suite and 4x resolution architecture/workflow diagrams in `documentation/`.
