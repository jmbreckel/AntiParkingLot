import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

export class ParkingLotStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, 'parking_lot.json');
  }

  _ensureDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  _readRaw() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { version: 1, items: [], draft: null };
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) {
        return { version: 1, items: [], draft: null };
      }
      return {
        version: parsed.version || 1,
        items: parsed.items,
        draft: parsed.draft || null,
      };
    } catch {
      return { version: 1, items: [], draft: null };
    }
  }

  _writeRaw(state) {
    this._ensureDir();
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  _sortItems(items) {
    return [...items].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'parked' ? -1 : 1;
      }
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      const oa = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const ob = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const pa = PRIORITY_WEIGHT[a.priority] ?? 1;
      const pb = PRIORITY_WEIGHT[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  getSnapshot(filters = {}) {
    const raw = this._readRaw();
    const allSorted = this._sortItems(raw.items);

    const projectsSet = new Set();
    let parkedCount = 0;
    let doneCount = 0;
    let pinnedCount = 0;

    for (const it of allSorted) {
      if (it.project && String(it.project).trim()) {
        projectsSet.add(String(it.project).trim());
      }
      if (it.status === 'done') {
        doneCount += 1;
      } else {
        parkedCount += 1;
        if (it.pinned) pinnedCount += 1;
      }
    }

    const wantStatus = (filters.status || 'all').toLowerCase();
    const wantProject = (filters.project || '').trim().toLowerCase();
    const wantPriority = (filters.priority || '').trim().toLowerCase();
    const wantSearch = (filters.search || '').trim().toLowerCase();

    const filtered = allSorted.filter((it) => {
      if (wantStatus === 'parked' && it.status !== 'parked') return false;
      if (wantStatus === 'done' && it.status !== 'done') return false;
      if (wantProject && String(it.project || '').trim().toLowerCase() !== wantProject) return false;
      if (wantPriority && String(it.priority || 'normal').toLowerCase() !== wantPriority) return false;
      if (wantSearch) {
        const hay = [
          it.title || '',
          it.prompt || '',
          it.notes || '',
          it.project || '',
          ...(Array.isArray(it.tags) ? it.tags : []),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(wantSearch)) return false;
      }
      return true;
    });

    return {
      items: filtered,
      allItems: allSorted,
      projects: Array.from(projectsSet).sort((a, b) => a.localeCompare(b)),
      draft: raw.draft || null,
      stats: {
        total: allSorted.length,
        parked: parkedCount,
        done: doneCount,
        pinned: pinnedCount,
      },
      activeFilters: {
        status: wantStatus,
        project: filters.project || '',
        priority: filters.priority || '',
        search: filters.search || '',
      },
    };
  }

  saveDraft(draft = {}) {
    const raw = this._readRaw();
    const prompt = String(draft.prompt || '');
    const notes = String(draft.notes || '');
    const project = String(draft.project || '');
    const priority = ['high', 'normal', 'low'].includes(String(draft.priority || '').toLowerCase())
      ? String(draft.priority).toLowerCase()
      : 'normal';
    const pinned = Boolean(draft.pinned);

    if (!prompt.trim() && !notes.trim()) {
      raw.draft = null;
    } else {
      raw.draft = {
        prompt,
        notes,
        project,
        priority,
        pinned,
        updatedAt: new Date().toISOString(),
      };
    }
    this._writeRaw(raw);
    return raw.draft;
  }

  saveItem(input = {}) {
    const raw = this._readRaw();
    const now = new Date().toISOString();
    const cleanPrompt = String(input.prompt || '').trim();
    if (!cleanPrompt) {
      throw new Error('Idea / prompt text cannot be empty.');
    }

    const cleanTags = Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim()).filter(Boolean)
      : String(input.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    const normPriority = ['high', 'normal', 'low'].includes(String(input.priority || '').toLowerCase())
      ? String(input.priority).toLowerCase()
      : 'normal';

    const autoTitle =
      String(input.title || '').trim() ||
      cleanPrompt.split('\n')[0].slice(0, 72) + (cleanPrompt.split('\n')[0].length > 72 ? '…' : '');

    if (input.id) {
      const idx = raw.items.findIndex((x) => x.id === input.id);
      if (idx >= 0) {
        const prev = raw.items[idx];
        const updated = {
          ...prev,
          title: input.title !== undefined ? (String(input.title).trim() || autoTitle) : prev.title,
          prompt: cleanPrompt,
          notes: input.notes !== undefined ? String(input.notes || '').trim() : (prev.notes || ''),
          project: input.project !== undefined ? String(input.project || '').trim() : (prev.project || ''),
          priority: input.priority !== undefined ? normPriority : (prev.priority || 'normal'),
          tags: input.tags !== undefined ? cleanTags : (prev.tags || []),
          pinned: input.pinned !== undefined ? Boolean(input.pinned) : Boolean(prev.pinned),
          updatedAt: now,
        };
        raw.items[idx] = updated;
        this._writeRaw(raw);
        return updated;
      }
    }

    const minOrder = raw.items.reduce(
      (acc, it) => (typeof it.sortOrder === 'number' && it.sortOrder < acc ? it.sortOrder : acc),
      1000
    );

    const created = {
      id: `pl_${crypto.randomBytes(4).toString('hex')}`,
      title: autoTitle,
      prompt: cleanPrompt,
      notes: String(input.notes || '').trim(),
      project: String(input.project || '').trim(),
      priority: normPriority,
      tags: cleanTags,
      pinned: Boolean(input.pinned),
      status: 'parked',
      sortOrder: minOrder - 10,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    raw.items.push(created);
    if (input.clearDraft) {
      raw.draft = null;
    }
    this._writeRaw(raw);
    return created;
  }

  updateStatus(idOrIds, patch = {}) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const idSet = new Set(ids.filter(Boolean));
    const raw = this._readRaw();
    const now = new Date().toISOString();
    const updatedItems = [];

    raw.items = raw.items.map((cur) => {
      if (!idSet.has(cur.id)) return cur;
      const nextStatus = patch.status
        ? (patch.status === 'done' ? 'done' : 'parked')
        : cur.status;
      const nextPinned = patch.pinned !== undefined ? Boolean(patch.pinned) : Boolean(cur.pinned);
      const updated = {
        ...cur,
        status: nextStatus,
        pinned: nextPinned,
        updatedAt: now,
        completedAt: nextStatus === 'done' ? (cur.completedAt || now) : null,
        launchCount: patch.incrementLaunch ? (Number(cur.launchCount || 0) + 1) : (cur.launchCount || 0),
        lastLaunchedAt: patch.incrementLaunch ? now : (cur.lastLaunchedAt || null),
      };
      updatedItems.push(updated);
      return updated;
    });

    if (updatedItems.length === 0) {
      throw new Error(`Parked prompt not found: ${ids.join(', ')}`);
    }

    this._writeRaw(raw);
    return Array.isArray(idOrIds) ? updatedItems : updatedItems[0];
  }

  moveItem(id, direction) {
    const raw = this._readRaw();
    const parked = this._sortItems(raw.items.filter((x) => x.status === 'parked'));
    const done = this._sortItems(raw.items.filter((x) => x.status === 'done'));

    const idx = parked.findIndex((x) => x.id === id);
    if (idx < 0) return null;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= parked.length) return parked[idx];

    const swapped = [...parked];
    const [moved] = swapped.splice(idx, 1);
    swapped.splice(targetIdx, 0, moved);

    swapped.forEach((item, i) => {
      item.sortOrder = (i + 1) * 10;
    });

    raw.items = [...swapped, ...done];
    this._writeRaw(raw);
    return moved;
  }

  deleteItem({ id, ids, clearDone = false } = {}) {
    const raw = this._readRaw();
    const before = raw.items.length;
    if (clearDone) {
      raw.items = raw.items.filter((x) => x.status !== 'done');
    } else if (Array.isArray(ids) && ids.length > 0) {
      const rmSet = new Set(ids);
      raw.items = raw.items.filter((x) => !rmSet.has(x.id));
    } else if (id) {
      raw.items = raw.items.filter((x) => x.id !== id);
    }
    const removedCount = before - raw.items.length;
    if (removedCount > 0) {
      this._writeRaw(raw);
    }
    return { removedCount };
  }
}
