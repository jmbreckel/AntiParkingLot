# AntiParkingLot — Instructions & Conversation Workflow

**Prompt Parking Lot** (`AntiParkingLot`) gives you a persistent scratchpad to capture ideas while Antigravity is busy working—without interrupting active runs—and dispatch them when you are ready.

---

## 1. How AntiParkingLot Works With Conversations

**Parking an idea does NOT create a conversation** (and never touches a running conversation or spends tokens). Your Parking Lot is a **single shared scratchpad saved locally on disk** (`~/.gemini/config/plugin-data/anti-parking-lot/parking_lot.json`) that sits alongside all of your conversations and workspaces.

### Stage A: While You Are Parking Ideas (Zero Conversation Activity)
- Open **`+` → Parking Lot** in the right-hand **Side Pane** next to any chat (or **Parking Lot** in the **Left Sidebar**).
- Typing or voice-dictating (`🎤 Voice`) and clicking **+ Park Idea** (`Ctrl+Enter`) communicates directly with the local plugin store on your machine.
- **No conversation is created**, and **the active conversation is never interrupted or queued behind**.
- Because the list is shared globally, an idea you park while watching Conversation A is immediately visible if you switch to Conversation B or open another workspace (you can tag ideas by **Project** to filter them).

### Stage B: When You Are Ready to Send an Idea (You Choose the Conversation)
When **Parking Lot** is open in the **Side Pane** next to an active chat, it knows which conversation it is docked beside and gives you **three conversation actions** on every card:

| Action | What It Does With Conversations | Best Used When… |
| :--- | :--- | :--- |
| **▶ Send Here** | Sends the prompt directly into **the current conversation** you have open (does **not** create a new conversation). | Antigravity has finished its current task and your follow-up builds on the context of this same chat. |
| **↗ New Chat** | **Creates a brand-new conversation** in the same workspace/project and starts running the prompt there in the background. | Your idea is an independent topic—or your current chat is still busy and you want a second agent working on the new idea in parallel. |
| **📎 Attach** | Attaches the parked idea as context onto your **next message in the current conversation** without sending yet. | You want to type extra instructions in the main chat box alongside one or more parked ideas before pressing Enter. |

> **Left Sidebar Note:** Opening **Parking Lot** full-screen from the **Left Sidebar** opens a global cross-project dashboard that isn't tied to a specific chat thread, so only **📋 Copy** and list management appear there. To use **▶ Send Here**, **↗ New Chat**, or **📎 Attach**, open **`+` → Parking Lot** in the **Side Pane** of the conversation where you're working.

---

## 2. Capturing Ideas (Typing & Voice-to-Text)

1. **Open the Side Pane:** Click **`+` → Parking Lot** in the right-hand Side Pane header.
2. **Enter Your Idea:**
   - **Keyboard:** Type into the top box (autofocused on open).
   - **In-App Voice Button (`🎤 Voice` or `Alt+V`):** Click **🎤 Voice** and speak naturally. Speech is transcribed locally into text inside the composer (using Windows Neural Speech Recognition with automatic offline `System.Speech` fallback). Click **⏹ Stop** (or `Alt+V`) when finished.
   - **OS Voice Typing (`Win+H`):** Press **`Win+H`** inside the composer box anytime to use native Windows Voice Typing.
   - **Draft Auto-Recovery:** Unsent text in the composer auto-saves after 450 ms (`Draft saved`), so closing the pane or switching tabs mid-thought never loses your text.
3. **Optional Metadata:** Tag a **Project**, pick a priority (`🔥 High`, `⚡ Normal`, `🧊 Low`), add a quick context **Note**, or check **`📌`** to pin to the top.
4. **Save:** Press **`Ctrl+Enter`** (`Cmd+Enter` on macOS) or click **+ Park Idea**.

---

## 3. Combining Multiple Ideas Together

If you park 2–3 related tweaks while Antigravity is running a long task, you can send them all together in a single turn once it finishes:

1. Check the selection box on the top-left of multiple parked cards.
2. Use the **Batch Action Bar** above the list:
   - **▶ Send (N)** — Merges the selected ideas into a numbered prompt (`1. ... 2. ...`) and sends it into the current conversation.
   - **↗ New Chat (N)** — Starts a brand-new conversation with all selected ideas combined.
   - **📋 Copy** — Copies the numbered prompt to your clipboard.
   - **✓ Done** — Marks all selected ideas Done at once.

---

## 4. Managing Your List

- **Auto-Complete on Send:** Keep **Mark done on send** checked in the top bar to automatically move sent items to the **Done** tab.
- **Reorder / Pin / Edit:** Use **`↑`** / **`↓`** to reorder, **`📌`** to pin critical ideas to the top, and **`✎`** to edit text or notes before sending.
- **Filter & Search:** Filter by **Parked / Done / All**, select a **Project** from the dropdown, or search across prompts, notes, and tags.
- **Chat Shorthand (Optional):** When your agent is idle, you can also say *"park: <idea>"* or *"open my parking lot"* directly in chat.
