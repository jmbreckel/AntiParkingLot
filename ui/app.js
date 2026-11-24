import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Prompt Parking Lot', version: '1.1.0' }, {});

const state = {
  allItems: [],
  projects: [],
  stats: { total: 0, parked: 0, done: 0, pinned: 0 },
  tab: 'parked',
  projectFilter: '',
  search: '',
  editingId: null,
  selectedIds: new Set(),
  attachedIds: new Set(),
  draftHydrated: false,
  canSendMessage: false,
  canUpdateContext: false,
  connected: false,
  voice: {
    active: false,
    mode: null, // 'server' | 'browser'
    cursor: 0,
    pollTimer: null,
    browserRec: null,
  },
};

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.display = 'none';
  }, 2400);
}

let draftStatusTimer = null;
function setDraftStatus(text, sticky = false) {
  const el = document.getElementById('draft-status');
  if (!el) return;
  el.textContent = text;
  clearTimeout(draftStatusTimer);
  if (text && !sticky) {
    draftStatusTimer = setTimeout(() => {
      el.textContent = '';
    }, 2000);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRelTime(iso) {
  if (!iso) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function appendDictatedText(segment) {
  const clean = String(segment || '').trim();
  if (!clean) return;
  const promptEl = document.getElementById('input-prompt');
  if (!promptEl) return;
  const cur = promptEl.value;
  const sep = cur && !/\s$/.test(cur) ? ' ' : '';
  promptEl.value = `${cur}${sep}${clean}`;
  promptEl.scrollTop = promptEl.scrollHeight;
  scheduleDraftSave();
}

function setVoiceUiState(active, previewText = '') {
  state.voice.active = active;
  const voiceBtn = document.getElementById('btn-voice');
  const composerBox = document.getElementById('composer-box');
  const previewEl = document.getElementById('voice-preview');

  if (voiceBtn) {
    voiceBtn.classList.toggle('active', active);
    voiceBtn.textContent = active ? '⏹ Stop' : '🎤 Voice';
  }
  if (composerBox) {
    composerBox.classList.toggle('listening', active);
  }
  if (previewEl) {
    if (active) {
      previewEl.style.display = 'flex';
      previewEl.textContent = previewText
        ? `🎙️ "${previewText}…"`
        : '🎙️ Listening… speak your idea clearly (click Stop when finished)';
    } else {
      previewEl.style.display = 'none';
      previewEl.textContent = '';
    }
  }
}

function hydrateDraftOnce(draft) {
  if (state.draftHydrated) return;
  state.draftHydrated = true;
  if (!draft || typeof draft !== 'object') return;

  const promptEl = document.getElementById('input-prompt');
  const notesEl = document.getElementById('input-notes');
  const projEl = document.getElementById('input-project');
  const prioEl = document.getElementById('input-priority');
  const pinEl = document.getElementById('input-pinned');

  if (promptEl && !promptEl.value && draft.prompt) {
    promptEl.value = draft.prompt;
    setDraftStatus('Draft restored');
  }
  if (notesEl && !notesEl.value && draft.notes) {
    notesEl.value = draft.notes;
  }
  if (projEl && !projEl.value && draft.project) {
    projEl.value = draft.project;
  }
  if (prioEl && draft.priority) {
    prioEl.value = draft.priority;
  }
  if (pinEl && draft.pinned) {
    pinEl.checked = Boolean(draft.pinned);
  }
}

function ingestSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return;
  if (Array.isArray(snap.allItems)) {
    state.allItems = snap.allItems;
  } else if (Array.isArray(snap.items)) {
    state.allItems = snap.items;
  }
  if (Array.isArray(snap.projects)) {
    state.projects = snap.projects;
  }
  if (snap.stats) {
    state.stats = snap.stats;
  }
  if ('draft' in snap) {
    hydrateDraftOnce(snap.draft);
  }
  if (snap.activeFilters) {
    if (snap.activeFilters.project && !state.projectFilter) {
      state.projectFilter = snap.activeFilters.project;
    }
    if (snap.activeFilters.status && ['parked', 'done', 'all'].includes(snap.activeFilters.status)) {
      state.tab = snap.activeFilters.status;
    }
  }
  const validIds = new Set(state.allItems.map((x) => x.id));
  for (const id of [...state.selectedIds]) {
    if (!validIds.has(id)) state.selectedIds.delete(id);
  }
  render();
}

async function callServer(name, args = {}) {
  const res = await app.callServerTool({ name, arguments: args });
  if (res?.structuredContent && !res.structuredContent.isVoiceOrDraft) {
    ingestSnapshot(res.structuredContent);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Hybrid Voice-to-Text Dictation (Host OS Speech + Web Speech API Fallback)
// ---------------------------------------------------------------------------

async function stopVoiceDictation() {
  clearInterval(state.voice.pollTimer);
  state.voice.pollTimer = null;

  if (state.voice.mode === 'browser' && state.voice.browserRec) {
    try {
      state.voice.browserRec.stop();
    } catch {}
    state.voice.browserRec = null;
  } else if (state.voice.mode === 'server') {
    try {
      const res = await callServer('app_voice_stop', { cursor: state.voice.cursor });
      const v = res?.structuredContent?.voice;
      if (Array.isArray(v?.newSegments)) {
        v.newSegments.forEach(appendDictatedText);
      }
    } catch {}
  }

  state.voice.mode = null;
  setVoiceUiState(false);
  setDraftStatus('');
  document.getElementById('input-prompt')?.focus();
}

function startBrowserSpeechFallback() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Tip: Press Win+H (or Fn+Fn on Mac) for OS voice typing');
    return false;
  }

  const rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) {
        appendDictatedText(transcript);
      } else {
        interim += transcript;
      }
    }
    setVoiceUiState(true, interim.trim());
  };

  rec.onerror = (ev) => {
    setVoiceUiState(false);
    state.voice.mode = null;
    state.voice.browserRec = null;
    showToast(`Voice error (${ev?.error || 'unavailable'}) — press Win+H for OS dictation`);
  };

  rec.onend = () => {
    if (state.voice.mode === 'browser') {
      setVoiceUiState(false);
      state.voice.mode = null;
      state.voice.browserRec = null;
    }
  };

  state.voice.mode = 'browser';
  state.voice.browserRec = rec;
  setVoiceUiState(true);
  rec.start();
  return true;
}

async function toggleVoiceDictation() {
  if (state.voice.active) {
    await stopVoiceDictation();
    showToast('✓ Voice dictation stopped');
    return;
  }

  try {
    const startRes = await callServer('app_voice_start', {});
    const v = startRes?.structuredContent?.voice;
    if (v?.supported) {
      state.voice.mode = 'server';
      state.voice.cursor = v.nextCursor || 0;
      setVoiceUiState(true);
      setDraftStatus('🎙️ Mic active', true);

      let pollInFlight = false;
      state.voice.pollTimer = setInterval(async () => {
        if (pollInFlight || !state.voice.active) return;
        pollInFlight = true;
        try {
          const pollRes = await callServer('app_voice_poll', { cursor: state.voice.cursor });
          const pv = pollRes?.structuredContent?.voice;
          if (!pv) return;
          state.voice.cursor = pv.nextCursor ?? state.voice.cursor;
          if (Array.isArray(pv.newSegments) && pv.newSegments.length > 0) {
            pv.newSegments.forEach(appendDictatedText);
          }
          if (pv.error) {
            showToast(`🎤 ${pv.error}`);
            await stopVoiceDictation();
            return;
          }
          if (!pv.active) {
            await stopVoiceDictation();
            return;
          }
          setVoiceUiState(true, pv.partial || '');
        } catch {
          // Ignore transient poll error
        } finally {
          pollInFlight = false;
        }
      }, 350);
      return;
    }
  } catch {
    // Fall back to Web Speech API if server voice tool is unavailable
  }

  startBrowserSpeechFallback();
}

// ---------------------------------------------------------------------------
// Clipboard, Context Attachment, and Chat Dispatch
// ---------------------------------------------------------------------------

async function copyText(text, label = '📋 Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(label);
  }
}

function buildCombinedPrompt(items) {
  if (items.length === 1) {
    const only = items[0];
    return only.notes ? `${only.prompt}\n\n(Context: ${only.notes})` : only.prompt;
  }
  return items
    .map((it, idx) => `${idx + 1}. ${it.prompt}${it.notes ? `\n   - Note: ${it.notes}` : ''}`)
    .join('\n\n');
}

async function syncAttachedContext() {
  if (!state.canUpdateContext) return;
  const selected = state.allItems.filter((it) => state.attachedIds.has(it.id));
  const banner = document.getElementById('ctx-banner');
  const bannerText = document.getElementById('ctx-banner-text');

  if (selected.length === 0) {
    if (banner) banner.style.display = 'none';
    await app.updateModelContext({ content: [] });
    return;
  }

  if (banner && bannerText) {
    banner.style.display = 'flex';
    bannerText.textContent = `📎 ${selected.length} parked idea${selected.length === 1 ? '' : 's'} attached to your next message`;
  }

  const textBlock = selected
    .map(
      (it, idx) =>
        `[Parked Idea #${idx + 1}${it.project ? ` (${it.project})` : ''}]\n${it.prompt}${it.notes ? `\nNotes: ${it.notes}` : ''}`
    )
    .join('\n\n---\n\n');

  await app.updateModelContext({
    content: [{ type: 'text', text: textBlock }],
  });
}

async function sendItemsToChat(items, targetNew = false) {
  if (!items || items.length === 0) return;
  const combinedText = buildCombinedPrompt(items);

  if (!state.canSendMessage) {
    await copyText(combinedText, '📋 Copied prompt (paste into chat when ready)');
    return;
  }
  try {
    const req = {
      role: 'user',
      content: [{ type: 'text', text: combinedText }],
    };
    if (targetNew) {
      req._meta = {
        'com.google.antigravity/message': { target: 'new' },
      };
    }
    await app.sendMessage(req);

    const ids = items.map((x) => x.id);
    const autoDone = document.getElementById('chk-auto-done')?.checked;
    if (autoDone) {
      await callServer('app_set_status', { ids, status: 'done', incrementLaunch: true });
      ids.forEach((id) => state.selectedIds.delete(id));
    } else {
      await callServer('app_set_status', { ids, incrementLaunch: true });
    }
    render();
    showToast(
      targetNew
        ? `↗ Launched ${items.length > 1 ? `${items.length} ideas ` : ''}in a new chat!`
        : `▶ Sent ${items.length > 1 ? `${items.length} ideas ` : ''}to Antigravity!`
    );
  } catch (err) {
    await copyText(combinedText, `📋 Copied instead (${err?.message || 'ready to paste'})`);
  }
}

function getFilteredItems() {
  const wantProj = state.projectFilter.trim().toLowerCase();
  const wantSearch = state.search.trim().toLowerCase();

  return state.allItems.filter((it) => {
    if (state.tab === 'parked' && it.status !== 'parked') return false;
    if (state.tab === 'done' && it.status !== 'done') return false;
    if (wantProj && String(it.project || '').trim().toLowerCase() !== wantProj) return false;
    if (wantSearch) {
      const hay = `${it.title || ''} ${it.prompt || ''} ${it.notes || ''} ${it.project || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(wantSearch)) return false;
    }
    return true;
  });
}

function renderBatchBar() {
  const bar = document.getElementById('batch-bar');
  const countEl = document.getElementById('batch-count');
  const sendBtn = document.getElementById('btn-batch-send');
  const newBtn = document.getElementById('btn-batch-new');
  if (!bar) return;

  const selectedItems = state.allItems.filter((it) => state.selectedIds.has(it.id));
  if (selectedItems.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  if (countEl) {
    countEl.textContent = `${selectedItems.length} idea${selectedItems.length === 1 ? '' : 's'} selected`;
  }
  if (sendBtn) {
    sendBtn.style.display = state.canSendMessage ? 'inline-flex' : 'none';
    sendBtn.textContent = `▶ Send (${selectedItems.length})`;
  }
  if (newBtn) {
    newBtn.style.display = state.canSendMessage ? 'inline-flex' : 'none';
    newBtn.textContent = `↗ New Chat (${selectedItems.length})`;
  }
}

function render() {
  const statsSub = document.getElementById('stats-sub');
  if (statsSub) {
    const p = state.stats.parked ?? 0;
    const d = state.stats.done ?? 0;
    statsSub.textContent = `${p} parked · ${d} completed`;
  }

  const autoDoneWrap = document.getElementById('auto-done-wrap');
  if (autoDoneWrap) {
    autoDoneWrap.style.display = state.canSendMessage ? 'inline-flex' : 'none';
  }

  renderBatchBar();

  const parkedTotal = state.allItems.filter((x) => x.status === 'parked').length;
  const doneTotal = state.allItems.filter((x) => x.status === 'done').length;
  const tabParked = document.getElementById('tab-parked');
  const tabDone = document.getElementById('tab-done');
  const tabAll = document.getElementById('tab-all');
  if (tabParked) tabParked.textContent = `Parked (${parkedTotal})`;
  if (tabDone) tabDone.textContent = `Done (${doneTotal})`;
  if (tabAll) tabAll.textContent = `All (${state.allItems.length})`;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  });

  const clearDoneBtn = document.getElementById('btn-clear-done');
  if (clearDoneBtn) {
    clearDoneBtn.style.display = doneTotal > 0 && (state.tab === 'done' || state.tab === 'all') ? 'inline-flex' : 'none';
  }

  const projSelect = document.getElementById('filter-project');
  const projDatalist = document.getElementById('project-datalist');
  if (projSelect) {
    const cur = state.projectFilter;
    projSelect.innerHTML =
      `<option value="">All Projects</option>` +
      state.projects.map((p) => `<option value="${escapeHtml(p)}"${p === cur ? ' selected' : ''}>📁 ${escapeHtml(p)}</option>`).join('');
  }
  if (projDatalist) {
    projDatalist.innerHTML = state.projects.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('');
  }

  const listEl = document.getElementById('cards-list');
  if (!listEl) return;

  const visible = getFilteredItems();
  if (visible.length === 0) {
    listEl.innerHTML = `
      <div class="empty">
        ${
          state.tab === 'done'
            ? 'No completed ideas yet.'
            : state.search || state.projectFilter
            ? 'No parked ideas match the current filter.'
            : 'No ideas parked right now. Type or click 🎤 Voice above while Antigravity works!'
        }
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  visible.forEach((item, idx) => {
    const isSelected = state.selectedIds.has(item.id);
    const card = document.createElement('div');
    card.className = `card${item.pinned ? ' pinned' : ''}${isSelected ? ' selected' : ''}${item.status === 'done' ? ' done' : ''}`;

    if (state.editingId === item.id) {
      card.classList.add('edit-box');
      card.innerHTML = `
        <textarea id="edit-prompt-${item.id}">${escapeHtml(item.prompt)}</textarea>
        <div class="composer-row">
          <input type="text" id="edit-proj-${item.id}" class="input-sm" list="project-datalist" value="${escapeHtml(item.project || '')}" placeholder="Project" style="flex: 1 1 110px;" />
          <select id="edit-prio-${item.id}">
            <option value="normal"${item.priority === 'normal' ? ' selected' : ''}>⚡ Normal</option>
            <option value="high"${item.priority === 'high' ? ' selected' : ''}>🔥 High</option>
            <option value="low"${item.priority === 'low' ? ' selected' : ''}>🧊 Low</option>
          </select>
          <input type="text" id="edit-notes-${item.id}" class="input-sm" value="${escapeHtml(item.notes || '')}" placeholder="Notes…" style="flex: 2 1 120px;" />
          <button type="button" class="btn btn-primary" data-act="save-edit">Save</button>
          <button type="button" class="btn" data-act="cancel-edit">Cancel</button>
        </div>
      `;
      card.querySelector('[data-act="save-edit"]').onclick = async () => {
        const newPrompt = document.getElementById(`edit-prompt-${item.id}`).value.trim();
        if (!newPrompt) return;
        await callServer('app_save_item', {
          id: item.id,
          prompt: newPrompt,
          project: document.getElementById(`edit-proj-${item.id}`).value.trim(),
          priority: document.getElementById(`edit-prio-${item.id}`).value,
          notes: document.getElementById(`edit-notes-${item.id}`).value.trim(),
        });
        state.editingId = null;
        render();
        showToast('Saved changes');
      };
      card.querySelector('[data-act="cancel-edit"]').onclick = () => {
        state.editingId = null;
        render();
      };
      listEl.appendChild(card);
      return;
    }

    const prioBadge =
      item.priority === 'high'
        ? `<span class="pill pill-high">🔥 HIGH</span>`
        : item.priority === 'low'
        ? `<span class="pill pill-low">🧊 LOW</span>`
        : '';
    const projBadge = item.project ? `<span class="pill pill-proj">📁 ${escapeHtml(item.project)}</span>` : '';
    const pinBadge = item.pinned ? `<span class="pill pill-pin">📌 Pinned</span>` : '';
    const tagBadges = (item.tags || []).map((t) => `<span class="pill">#${escapeHtml(t)}</span>`).join('');
    const isAttached = state.attachedIds.has(item.id);

    card.innerHTML = `
      <div class="card-head">
        <div class="card-badges">
          <input type="checkbox" class="card-select-chk" data-act="select" title="Select to combine or batch-send multiple ideas"${isSelected ? ' checked' : ''} />
          ${pinBadge}${prioBadge}${projBadge}${tagBadges}
          <span style="font-size: 11px; color: var(--text-tertiary);">${formatRelTime(item.createdAt)}</span>
        </div>
        <div class="action-group">
          ${
            item.status === 'parked'
              ? `<button type="button" class="btn btn-icon" data-act="up" title="Move up"${idx === 0 ? ' disabled' : ''}>↑</button>
                 <button type="button" class="btn btn-icon" data-act="down" title="Move down"${idx === visible.length - 1 ? ' disabled' : ''}>↓</button>`
              : ''
          }
          <button type="button" class="btn btn-icon" data-act="pin" title="${item.pinned ? 'Unpin' : 'Pin to top'}">📌</button>
          <button type="button" class="btn btn-icon" data-act="edit" title="Edit idea">✎</button>
          <button type="button" class="btn btn-danger btn-icon" data-act="delete" title="Delete">✕</button>
        </div>
      </div>
      <div class="prompt-body">${escapeHtml(item.prompt)}</div>
      ${item.notes ? `<div class="notes-line">💡 ${escapeHtml(item.notes)}</div>` : ''}
      <div class="card-foot">
        <div class="action-group">
          ${
            state.canSendMessage
              ? `<button type="button" class="btn btn-send" data-act="send-here" title="Send into the current conversation when you are ready">▶ Send Here</button>
                 <button type="button" class="btn btn-newchat" data-act="send-new" title="Start a separate conversation in this project with this idea">↗ New Chat</button>`
              : ''
          }
          ${
            state.canUpdateContext
              ? `<button type="button" class="btn ${isAttached ? 'btn-ctx-active' : ''}" data-act="attach-ctx" title="Attach this idea as context on your next message">${isAttached ? '📎 Attached' : '📎 Attach'}</button>`
              : ''
          }
          <button type="button" class="btn" data-act="copy" title="Copy idea text to clipboard">📋 Copy</button>
        </div>
        <div class="action-group">
          <button type="button" class="btn" data-act="toggle-done">
            ${item.status === 'done' ? '↩ Reopen' : '✓ Done'}
          </button>
        </div>
      </div>
    `;

    const bind = (sel, fn) => {
      const b = card.querySelector(sel);
      if (b) b.onclick = fn;
    };

    const chk = card.querySelector('[data-act="select"]');
    if (chk) {
      chk.onchange = () => {
        if (chk.checked) {
          state.selectedIds.add(item.id);
        } else {
          state.selectedIds.delete(item.id);
        }
        render();
      };
    }

    bind('[data-act="send-here"]', () => sendItemsToChat([item], false));
    bind('[data-act="send-new"]', () => sendItemsToChat([item], true));
    bind('[data-act="copy"]', () => copyText(buildCombinedPrompt([item]), '📋 Copied idea to clipboard'));
    bind('[data-act="attach-ctx"]', async () => {
      if (state.attachedIds.has(item.id)) {
        state.attachedIds.delete(item.id);
      } else {
        state.attachedIds.add(item.id);
      }
      render();
      await syncAttachedContext();
    });
    bind('[data-act="toggle-done"]', async () => {
      const next = item.status === 'done' ? 'parked' : 'done';
      await callServer('app_set_status', { id: item.id, status: next });
      if (next === 'done') {
        state.selectedIds.delete(item.id);
        if (state.attachedIds.has(item.id)) {
          state.attachedIds.delete(item.id);
          await syncAttachedContext();
        }
      }
      render();
    });
    bind('[data-act="pin"]', () => callServer('app_set_status', { id: item.id, pinned: !item.pinned }));
    bind('[data-act="edit"]', () => {
      state.editingId = item.id;
      render();
    });
    bind('[data-act="delete"]', async () => {
      state.selectedIds.delete(item.id);
      state.attachedIds.delete(item.id);
      await callServer('app_delete_item', { id: item.id });
      await syncAttachedContext();
      showToast('Removed parked idea');
    });
    bind('[data-act="up"]', () => callServer('app_reorder_item', { id: item.id, direction: 'up' }));
    bind('[data-act="down"]', () => callServer('app_reorder_item', { id: item.id, direction: 'down' }));

    listEl.appendChild(card);
  });
}

let draftDebounce = null;
function scheduleDraftSave() {
  if (!state.connected) return;
  clearTimeout(draftDebounce);
  draftDebounce = setTimeout(async () => {
    const promptInput = document.getElementById('input-prompt');
    const projInput = document.getElementById('input-project');
    const prioInput = document.getElementById('input-priority');
    const notesInput = document.getElementById('input-notes');
    const pinInput = document.getElementById('input-pinned');
    try {
      await callServer('app_save_draft', {
        prompt: promptInput?.value || '',
        project: projInput?.value || '',
        priority: prioInput?.value || 'normal',
        notes: notesInput?.value || '',
        pinned: Boolean(pinInput?.checked),
      });
      if ((promptInput?.value || '').trim() && !state.voice.active) {
        setDraftStatus('Draft saved');
      }
    } catch {
      // Ignore transient draft errors
    }
  }, 450);
}

function bindControls() {
  const parkBtn = document.getElementById('btn-park');
  const voiceBtn = document.getElementById('btn-voice');
  const promptInput = document.getElementById('input-prompt');
  const projInput = document.getElementById('input-project');
  const prioInput = document.getElementById('input-priority');
  const notesInput = document.getElementById('input-notes');
  const pinInput = document.getElementById('input-pinned');

  const submitNewPrompt = async () => {
    if (state.voice.active) {
      await stopVoiceDictation();
    }
    const text = (promptInput?.value || '').trim();
    if (!text) {
      promptInput?.focus();
      return;
    }
    clearTimeout(draftDebounce);
    parkBtn.disabled = true;
    try {
      await callServer('app_save_item', {
        prompt: text,
        project: (projInput?.value || '').trim(),
        priority: prioInput?.value || 'normal',
        notes: (notesInput?.value || '').trim(),
        pinned: Boolean(pinInput?.checked),
        clearDraft: true,
      });
      promptInput.value = '';
      if (notesInput) notesInput.value = '';
      if (pinInput) pinInput.checked = false;
      setDraftStatus('');
      state.tab = 'parked';
      render();
      promptInput.focus();
      showToast('✓ Idea parked!');
    } finally {
      parkBtn.disabled = false;
    }
  };

  if (parkBtn) parkBtn.onclick = submitNewPrompt;
  if (voiceBtn) voiceBtn.onclick = toggleVoiceDictation;

  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      toggleVoiceDictation();
    }
  });

  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitNewPrompt();
      }
    });
    promptInput.addEventListener('input', scheduleDraftSave);
  }
  if (notesInput) notesInput.addEventListener('input', scheduleDraftSave);
  if (projInput) projInput.addEventListener('input', scheduleDraftSave);
  if (prioInput) prioInput.addEventListener('change', scheduleDraftSave);
  if (pinInput) pinInput.addEventListener('change', scheduleDraftSave);

  const getSelected = () => state.allItems.filter((it) => state.selectedIds.has(it.id));
  const batchSend = document.getElementById('btn-batch-send');
  const batchNew = document.getElementById('btn-batch-new');
  const batchCopy = document.getElementById('btn-batch-copy');
  const batchDone = document.getElementById('btn-batch-done');
  const batchClear = document.getElementById('btn-batch-clear');

  if (batchSend) batchSend.onclick = () => sendItemsToChat(getSelected(), false);
  if (batchNew) batchNew.onclick = () => sendItemsToChat(getSelected(), true);
  if (batchCopy) {
    batchCopy.onclick = () => {
      const sel = getSelected();
      if (sel.length) copyText(buildCombinedPrompt(sel), `📋 Copied ${sel.length} ideas`);
    };
  }
  if (batchDone) {
    batchDone.onclick = async () => {
      const ids = getSelected().map((x) => x.id);
      if (!ids.length) return;
      await callServer('app_set_status', { ids, status: 'done' });
      state.selectedIds.clear();
      render();
      showToast(`✓ Marked ${ids.length} done`);
    };
  }
  if (batchClear) {
    batchClear.onclick = () => {
      state.selectedIds.clear();
      render();
    };
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.onclick = () => {
      state.tab = btn.dataset.tab || 'parked';
      render();
    };
  });

  const filterProj = document.getElementById('filter-project');
  if (filterProj) {
    filterProj.onchange = () => {
      state.projectFilter = filterProj.value;
      render();
    };
  }

  const filterSearch = document.getElementById('filter-search');
  if (filterSearch) {
    filterSearch.oninput = () => {
      state.search = filterSearch.value;
      render();
    };
  }

  const clearDoneBtn = document.getElementById('btn-clear-done');
  if (clearDoneBtn) {
    clearDoneBtn.onclick = async () => {
      await callServer('app_delete_item', { clearDone: true });
      showToast('Cleared completed ideas');
    };
  }

  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await callServer('app_get_state', {});
      showToast('Refreshed');
    };
  }

  const clearCtxBtn = document.getElementById('btn-clear-ctx');
  if (clearCtxBtn) {
    clearCtxBtn.onclick = async () => {
      state.attachedIds.clear();
      render();
      await syncAttachedContext();
    };
  }
}

app.ontoolinput = ({ arguments: args }) => {
  if (args?.project) {
    state.projectFilter = String(args.project);
    const projIn = document.getElementById('input-project');
    if (projIn && !projIn.value) projIn.value = String(args.project);
  }
  if (args?.status && ['parked', 'done', 'all'].includes(args.status)) {
    state.tab = args.status;
  }
};

app.ontoolresult = (result) => {
  if (result?.structuredContent && !result.structuredContent.isVoiceOrDraft) {
    ingestSnapshot(result.structuredContent);
  }
};

app.onhostcontextchanged = (ctx) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

async function boot() {
  bindControls();
  await app.connect();
  state.connected = true;

  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);

  const caps = app.getHostCapabilities() || {};
  state.canSendMessage = Boolean(caps.message);
  state.canUpdateContext = Boolean(caps.updateModelContext);
  render();

  try {
    await callServer('app_get_state', {});
  } catch {
    // Initial toolresult will populate if already in flight
  }

  document.getElementById('input-prompt')?.focus();
}

boot();
