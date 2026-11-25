import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const MAX_THUMB_CHARS = 90000;

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
};

const EXT_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export class ParkingLotStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, 'parking_lot.json');
    this.screenshotsDir = path.join(this.dataDir, 'screenshots');
  }

  _ensureDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  _ensureScreenshotsDir() {
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
  }

  _hydrateScreenshotMeta(s) {
    if (!s || typeof s !== 'object' || !s.filename) return null;
    const safeFilename = path.basename(String(s.filename));
    const ext = path.extname(safeFilename).toLowerCase();
    return {
      id: String(s.id || path.basename(safeFilename, ext)),
      filename: safeFilename,
      filePath: path.join(this.screenshotsDir, safeFilename),
      mimeType: String(s.mimeType || EXT_TO_MIME[ext] || 'image/png'),
      name: String(s.name || safeFilename).slice(0, 140),
      sizeBytes: Number(s.sizeBytes) || 0,
      width: Number(s.width) > 0 ? Number(s.width) : null,
      height: Number(s.height) > 0 ? Number(s.height) : null,
      thumbDataUrl:
        typeof s.thumbDataUrl === 'string' &&
        s.thumbDataUrl.startsWith('data:image/') &&
        s.thumbDataUrl.length <= MAX_THUMB_CHARS
          ? s.thumbDataUrl
          : null,
      createdAt: s.createdAt || null,
    };
  }

  _normalizeScreenshotsInput(screenshotsInput, existingList = []) {
    if (!Array.isArray(screenshotsInput)) return [];
    const byId = new Map();
    const byPath = new Map();
    for (const ex of existingList) {
      const h = this._hydrateScreenshotMeta(ex);
      if (h) {
        byId.set(h.id, h);
        byPath.set(h.filePath.toLowerCase(), h);
      }
    }

    const result = [];
    const seenIds = new Set();
    for (const entry of screenshotsInput) {
      let meta = null;
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        meta = byId.get(trimmed) || byPath.get(path.resolve(trimmed).toLowerCase()) || this.importScreenshotFromPath(trimmed);
      } else if (entry && typeof entry === 'object') {
        if (entry.dataUrl && !entry.filename) {
          meta = this.saveScreenshot(entry);
        } else {
          meta = this._hydrateScreenshotMeta(entry);
        }
      }
      if (meta && !seenIds.has(meta.id)) {
        seenIds.add(meta.id);
        result.push(meta);
      }
    }
    return result;
  }

  _cleanupUnreferencedFiles(raw, candidateFilenames = []) {
    if (!candidateFilenames.length) return;
    const referenced = new Set();
    for (const it of raw.items || []) {
      for (const s of it.screenshots || []) {
        if (s?.filename) referenced.add(path.basename(String(s.filename)));
      }
    }
    for (const s of raw.draft?.screenshots || []) {
      if (s?.filename) referenced.add(path.basename(String(s.filename)));
    }
    for (const fn of candidateFilenames) {
      const safe = path.basename(String(fn || ''));
      if (!safe || referenced.has(safe)) continue;
      const target = path.join(this.screenshotsDir, safe);
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      } catch {
        // Ignore best-effort cleanup errors
      }
    }
  }

  saveScreenshot({ dataUrl, name, width, height, thumbDataUrl } = {}) {
    const rawStr = String(dataUrl || '').trim();
    const match = rawStr.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
      throw new Error('Invalid screenshot image data URL.');
    }
    const mimeType = match[1].toLowerCase();
    const ext = MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new Error(`Unsupported screenshot format: ${mimeType}`);
    }
    const buf = Buffer.from(match[2], 'base64');
    if (!buf.length) {
      throw new Error('Screenshot image is empty.');
    }
    if (buf.length > MAX_SCREENSHOT_BYTES) {
      throw new Error('Screenshot exceeds 15 MB limit.');
    }

    this._ensureScreenshotsDir();
    const id = `ss_${crypto.randomBytes(5).toString('hex')}`;
    const filename = `${id}${ext}`;
    const filePath = path.join(this.screenshotsDir, filename);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, filePath);

    let safeThumb =
      typeof thumbDataUrl === 'string' &&
      thumbDataUrl.startsWith('data:image/') &&
      thumbDataUrl.length <= MAX_THUMB_CHARS
        ? thumbDataUrl
        : null;
    if (!safeThumb && rawStr.length <= 65536) {
      safeThumb = rawStr;
    }

    return {
      id,
      filename,
      filePath,
      mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
      name: String(name || filename).slice(0, 140),
      sizeBytes: buf.length,
      width: Number(width) > 0 ? Number(width) : null,
      height: Number(height) > 0 ? Number(height) : null,
      thumbDataUrl: safeThumb,
      createdAt: new Date().toISOString(),
    };
  }

  importScreenshotFromPath(srcPath) {
    const resolved = path.resolve(String(srcPath || '').trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`Screenshot file not found: ${srcPath}`);
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeType = EXT_TO_MIME[ext];
    if (!mimeType) {
      throw new Error(`Unsupported image extension "${ext}" for ${srcPath}`);
    }
    const buf = fs.readFileSync(resolved);
    if (!buf.length || buf.length > MAX_SCREENSHOT_BYTES) {
      throw new Error(`Screenshot file must be non-empty and under 15 MB: ${srcPath}`);
    }

    this._ensureScreenshotsDir();
    const id = `ss_${crypto.randomBytes(5).toString('hex')}`;
    const filename = `${id}${ext === '.jpeg' ? '.jpg' : ext}`;
    const filePath = path.join(this.screenshotsDir, filename);
    fs.writeFileSync(filePath, buf);

    const b64 = buf.length <= 49152 ? `data:${mimeType};base64,${buf.toString('base64')}` : null;
    return {
      id,
      filename,
      filePath,
      mimeType,
      name: path.basename(resolved).slice(0, 140),
      sizeBytes: buf.length,
      width: null,
      height: null,
      thumbDataUrl: b64,
      createdAt: new Date().toISOString(),
    };
  }

  getScreenshotDataUrl(id) {
    const cleanId = String(id || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
      throw new Error('Invalid screenshot ID.');
    }
    const raw = this._readRaw();
    let found = null;
    for (const it of raw.items || []) {
      const m = (it.screenshots || []).find((s) => s?.id === cleanId);
      if (m) {
        found = this._hydrateScreenshotMeta(m);
        break;
      }
    }
    if (!found && Array.isArray(raw.draft?.screenshots)) {
      const m = raw.draft.screenshots.find((s) => s?.id === cleanId);
      if (m) found = this._hydrateScreenshotMeta(m);
    }
    if (!found && fs.existsSync(this.screenshotsDir)) {
      const matchFile = fs.readdirSync(this.screenshotsDir).find((f) => path.basename(f, path.extname(f)) === cleanId);
      if (matchFile) {
        found = this._hydrateScreenshotMeta({ id: cleanId, filename: matchFile });
      }
    }
    if (!found || !fs.existsSync(found.filePath)) {
      throw new Error(`Screenshot not found: ${cleanId}`);
    }
    const buf = fs.readFileSync(found.filePath);
    return {
      id: found.id,
      name: found.name,
      mimeType: found.mimeType,
      filePath: found.filePath,
      width: found.width,
      height: found.height,
      dataUrl: `data:${found.mimeType};base64,${buf.toString('base64')}`,
    };
  }

  deleteScreenshot(id) {
    const cleanId = String(id || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) return { deleted: false };
    const raw = this._readRaw();
    const candidates = [];

    if (Array.isArray(raw.draft?.screenshots)) {
      const before = raw.draft.screenshots.length;
      raw.draft.screenshots = raw.draft.screenshots.filter((s) => {
        if (s?.id === cleanId) {
          if (s.filename) candidates.push(s.filename);
          return false;
        }
        return true;
      });
      if (raw.draft.screenshots.length !== before) {
        if (!raw.draft.prompt?.trim() && !raw.draft.notes?.trim() && raw.draft.screenshots.length === 0) {
          raw.draft = null;
        }
        this._writeRaw(raw);
      }
    }

    if (fs.existsSync(this.screenshotsDir)) {
      for (const f of fs.readdirSync(this.screenshotsDir)) {
        if (path.basename(f, path.extname(f)) === cleanId) {
          candidates.push(f);
        }
      }
    }
    this._cleanupUnreferencedFiles(raw, candidates);
    return { deleted: true };
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
    const hydratedItems = raw.items.map((it) => ({
      ...it,
      screenshots: Array.isArray(it.screenshots)
        ? it.screenshots.map((s) => this._hydrateScreenshotMeta(s)).filter(Boolean)
        : [],
    }));
    const allSorted = this._sortItems(hydratedItems);

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
          ...(Array.isArray(it.screenshots) ? it.screenshots.map((s) => `${s.name || ''} screenshot image`) : []),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(wantSearch)) return false;
      }
      return true;
    });

    const hydratedDraft = raw.draft
      ? {
          ...raw.draft,
          screenshots: Array.isArray(raw.draft.screenshots)
            ? raw.draft.screenshots.map((s) => this._hydrateScreenshotMeta(s)).filter(Boolean)
            : [],
        }
      : null;

    return {
      items: filtered,
      allItems: allSorted,
      projects: Array.from(projectsSet).sort((a, b) => a.localeCompare(b)),
      draft: hydratedDraft,
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
    const prevDraftFiles = Array.isArray(raw.draft?.screenshots)
      ? raw.draft.screenshots.map((s) => s?.filename).filter(Boolean)
      : [];
    const prompt = String(draft.prompt || '');
    const notes = String(draft.notes || '');
    const project = String(draft.project || '');
    const priority = ['high', 'normal', 'low'].includes(String(draft.priority || '').toLowerCase())
      ? String(draft.priority).toLowerCase()
      : 'normal';
    const pinned = Boolean(draft.pinned);
    const screenshots =
      draft.screenshots !== undefined
        ? this._normalizeScreenshotsInput(draft.screenshots, raw.draft?.screenshots || [])
        : Array.isArray(raw.draft?.screenshots)
        ? raw.draft.screenshots.map((s) => this._hydrateScreenshotMeta(s)).filter(Boolean)
        : [];

    if (!prompt.trim() && !notes.trim() && screenshots.length === 0) {
      raw.draft = null;
    } else {
      raw.draft = {
        prompt,
        notes,
        project,
        priority,
        pinned,
        screenshots,
        updatedAt: new Date().toISOString(),
      };
    }
    this._writeRaw(raw);
    this._cleanupUnreferencedFiles(raw, prevDraftFiles);
    return raw.draft;
  }

  saveItem(input = {}) {
    const raw = this._readRaw();
    const now = new Date().toISOString();

    let prevItem = null;
    let editIdx = -1;
    if (input.id) {
      editIdx = raw.items.findIndex((x) => x.id === input.id);
      if (editIdx >= 0) prevItem = raw.items[editIdx];
    }

    const screenshots =
      input.screenshots !== undefined
        ? this._normalizeScreenshotsInput(input.screenshots, [
            ...(prevItem?.screenshots || []),
            ...(raw.draft?.screenshots || []),
          ])
        : Array.isArray(prevItem?.screenshots)
        ? prevItem.screenshots.map((s) => this._hydrateScreenshotMeta(s)).filter(Boolean)
        : [];

    let cleanPrompt = String(input.prompt || '').trim();
    if (!cleanPrompt && screenshots.length > 0) {
      cleanPrompt = screenshots.length > 1 ? 'Review attached screenshots' : 'Review attached screenshot';
    }
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

    if (editIdx >= 0 && prevItem) {
      const prevFiles = (prevItem.screenshots || []).map((s) => s?.filename).filter(Boolean);
      const updated = {
        ...prevItem,
        title: input.title !== undefined ? (String(input.title).trim() || autoTitle) : prevItem.title,
        prompt: cleanPrompt,
        notes: input.notes !== undefined ? String(input.notes || '').trim() : (prevItem.notes || ''),
        project: input.project !== undefined ? String(input.project || '').trim() : (prevItem.project || ''),
        priority: input.priority !== undefined ? normPriority : (prevItem.priority || 'normal'),
        tags: input.tags !== undefined ? cleanTags : (prevItem.tags || []),
        pinned: input.pinned !== undefined ? Boolean(input.pinned) : Boolean(prevItem.pinned),
        screenshots,
        updatedAt: now,
      };
      raw.items[editIdx] = updated;
      this._writeRaw(raw);
      this._cleanupUnreferencedFiles(raw, prevFiles);
      return updated;
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
      screenshots,
      status: 'parked',
      sortOrder: minOrder - 10,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    const prevDraftFiles =
      input.clearDraft && Array.isArray(raw.draft?.screenshots)
        ? raw.draft.screenshots.map((s) => s?.filename).filter(Boolean)
        : [];

    raw.items.push(created);
    if (input.clearDraft) {
      raw.draft = null;
    }
    this._writeRaw(raw);
    this._cleanupUnreferencedFiles(raw, prevDraftFiles);
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
    let removedItems = [];
    if (clearDone) {
      removedItems = raw.items.filter((x) => x.status === 'done');
      raw.items = raw.items.filter((x) => x.status !== 'done');
    } else if (Array.isArray(ids) && ids.length > 0) {
      const rmSet = new Set(ids);
      removedItems = raw.items.filter((x) => rmSet.has(x.id));
      raw.items = raw.items.filter((x) => !rmSet.has(x.id));
    } else if (id) {
      removedItems = raw.items.filter((x) => x.id === id);
      raw.items = raw.items.filter((x) => x.id !== id);
    }
    const removedCount = before - raw.items.length;
    if (removedCount > 0) {
      this._writeRaw(raw);
      const removedFiles = removedItems.flatMap((it) => (it.screenshots || []).map((s) => s?.filename).filter(Boolean));
      this._cleanupUnreferencedFiles(raw, removedFiles);
    }
    return { removedCount };
  }
}
