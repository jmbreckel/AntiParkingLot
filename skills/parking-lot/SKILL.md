---
name: parking-lot
description: Open, list, park, or complete deferred ideas in the Prompt Parking Lot (`AntiParkingLot_parking-lot` MCP tools). Activate when the user asks to open their parking lot, review parked ideas, park a follow-up prompt, or run an item from their parking lot.
---

# Prompt Parking Lot Skill

The user primarily captures ideas directly inside the **Parking Lot** Side Pane (`+` menu → **Parking Lot**) or Left Sidebar while Antigravity is busy working so they never have to interrupt an active run. Use the `AntiParkingLot_parking-lot` MCP tools whenever they interact with their Parking Lot from chat:


1. **Opening the Side-Pane UI (`open_parking_lot`):**
   - When the user asks to _"open my parking lot"_ or _"show my parked ideas"_, call `open_parking_lot` (optionally passing `project`). Because `open_parking_lot` declares an `aux_pane` entrypoint, Antigravity opens it directly in the Side Pane.

1. **Parking an idea from chat (`park_prompt`):**
   - If the user says _"park: <idea>"_ or _"save this for later"_, call `park_prompt` with `prompt`, `project` (current workspace folder basename unless specified otherwise), `priority` (`"high"`, `"normal"`, `"low"`), optional `notes`, and optional `screenshots` (array of local image paths). Confirm in one brief sentence.

1. **Reviewing or completing parked ideas (`list_parked_prompts` / `complete_parked_prompt`):**
   - Call `list_parked_prompts` (`status: "parked"`) to view queued ideas (if an item lists attached `*Screenshot:*` file paths, inspect them with `read_file`), and call `complete_parked_prompt` with `id` once a parked task is finished.
