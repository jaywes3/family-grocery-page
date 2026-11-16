/* Shared Grocery board client. Uses GitHub's Contents API; tokens are entered by the user and are never part of the app files or family-data backups. */
(function (root) {
  'use strict';

  const SETTINGS_KEY = 'familyHubGrocerySyncSettingsV1';
  const SESSION_TOKEN_KEY = 'familyHubGrocerySyncTokenSessionV1';
  const REMEMBERED_TOKEN_KEY = 'familyHubGrocerySyncTokenRememberedV1';
  const API_BASE = 'https://api.github.com';
  const DATA_FILE = 'grocery.json';
  const APP_NAME = 'Hearthside Shared Grocery List';
  const FORMAT_VERSION = 2;
  const MAX_ITEMS = 10000;
  const MAX_SECTIONS = 200;
  const MAX_TEXT = 500;
  const MAX_SECTION_NAME = 60;
  const SEED_TIMESTAMP = '2020-01-01T00:00:00.000Z';
  const BUILTIN_SECTIONS = [
    { id: 'groceries', name: 'Groceries', icon: '🛒' },
    { id: 'target', name: 'Target', icon: '🎯' },
    { id: 'costco', name: 'Costco', icon: '🛒' },
    { id: 'lakehouse', name: 'Lakehouse', icon: '🏡' }
  ];

  function storageGet(storage, key) {
    try { return storage && storage.getItem(key); } catch (_) { return null; }
  }
  function storageSet(storage, key, value) {
    try { if (storage) storage.setItem(key, String(value)); return true; } catch (_) { return false; }
  }
  function storageRemove(storage, key) {
    try { if (storage) storage.removeItem(key); } catch (_) { /* Storage may be blocked. */ }
  }
  function normalizeRepo(value) {
    let input = String(value || '').trim();
    if (!input) return '';
    if (/^https?:\/\//i.test(input)) {
      try {
        const url = new URL(input);
        if (url.hostname.toLowerCase() !== 'github.com') return '';
        input = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
      } catch (_) { return ''; }
    }
    const match = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    return match ? `${match[1]}/${match[2]}` : '';
  }
  function getSettings() {
    try {
      const saved = JSON.parse(storageGet(root.localStorage, SETTINGS_KEY) || '{}');
      return { repo: normalizeRepo(saved.repo) };
    } catch (_) { return { repo: '' }; }
  }
  function saveSettings(repo) {
    const normalized = normalizeRepo(repo);
    if (!normalized) throw new Error('Enter a GitHub repository as owner/name, or paste its github.com URL.');
    if (!storageSet(root.localStorage, SETTINGS_KEY, JSON.stringify({ repo: normalized }))) {
      throw new Error('This browser could not save the grocery repository setting.');
    }
    return { repo: normalized };
  }
  function getToken() {
    return storageGet(root.sessionStorage, SESSION_TOKEN_KEY) || storageGet(root.localStorage, REMEMBERED_TOKEN_KEY) || '';
  }
  function hasToken() { return !!getToken(); }
  function tokenIsRemembered() { return !!storageGet(root.localStorage, REMEMBERED_TOKEN_KEY); }
  function setToken(value, rememberOnThisDevice) {
    const token = String(value || '').trim();
    if (!token) throw new Error('Paste a fine-grained GitHub token to connect this device for edits.');
    if (rememberOnThisDevice) {
      if (!storageSet(root.localStorage, REMEMBERED_TOKEN_KEY, token)) throw new Error('This browser could not remember the token. Uncheck “Remember on this device” and try again.');
      storageRemove(root.sessionStorage, SESSION_TOKEN_KEY);
    } else {
      if (!storageSet(root.sessionStorage, SESSION_TOKEN_KEY, token)) throw new Error('This browser could not keep the token for this tab session.');
      storageRemove(root.localStorage, REMEMBERED_TOKEN_KEY);
    }
  }
  function clearToken() {
    storageRemove(root.sessionStorage, SESSION_TOKEN_KEY);
    storageRemove(root.localStorage, REMEMBERED_TOKEN_KEY);
  }
  function clearConnection() {
    storageRemove(root.localStorage, SETTINGS_KEY);
    clearToken();
  }
  function nowISO() { return new Date().toISOString(); }
  function cleanISO(value) {
    if (typeof value !== 'string' || !value) return '';
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : '';
  }
  function nextISO(value) { return new Date(Math.max(Date.now(), (Date.parse(value) || 0) + 1)).toISOString(); }
  function makeId() {
    try { if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID(); } catch (_) { /* Use the fallback below. */ }
    try {
      const bytes = new Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      return 'g-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }
  function sectionTextKey(value) {
    let text = String(value || '').trim().replace(/\s+/g, ' ');
    try { text = text.normalize('NFKC'); } catch (_) { /* Older browsers keep the original text. */ }
    return text.toLocaleLowerCase();
  }
  function sectionIdForName(value) {
    const key = sectionTextKey(value);
    const builtIn = { groceries: 'groceries', target: 'target', costco: 'costco', lakehouse: 'lakehouse' };
    if (Object.prototype.hasOwnProperty.call(builtIn, key)) return builtIn[key];
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    let slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'list';
    return `section-${slug}-${(hash >>> 0).toString(16)}`;
  }
  function initialSections() {
    return BUILTIN_SECTIONS.map(section => ({ ...section, createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP }));
  }
  function legacyId(text, index) {
    const input = `${index}:${String(text || '').trim().toLocaleLowerCase()}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `legacy-${(hash >>> 0).toString(16)}-${index}`;
  }
  function normalizeSection(value, index = 0) {
    if (!value || typeof value !== 'object') return null;
    const name = String(value.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > MAX_SECTION_NAME) return null;
    const id = typeof value.id === 'string' && value.id.trim() && value.id.length <= 160 ? value.id.trim() : sectionIdForName(name);
    const createdAt = cleanISO(value.createdAt) || SEED_TIMESTAMP;
    const updatedAt = cleanISO(value.updatedAt) || createdAt;
    const section = {
      id, name,
      icon: String(value.icon || (id === 'groceries' ? '🛒' : '🧺')).slice(0, 12),
      createdAt, updatedAt
    };
    const deletedAt = cleanISO(value.deletedAt);
    if (deletedAt) section.deletedAt = deletedAt;
    return section;
  }
  function compareSections(a, b) {
    const ta = Date.parse(a.updatedAt) || 0, tb = Date.parse(b.updatedAt) || 0;
    if (ta !== tb) return ta - tb;
    if (!!a.deletedAt !== !!b.deletedAt) return a.deletedAt ? 1 : -1;
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  }
  function normalizeSections(values) {
    if (!Array.isArray(values)) return [];
    const byId = new Map();
    for (const section of values.slice(0, MAX_SECTIONS).map(normalizeSection).filter(Boolean)) {
      const previous = byId.get(section.id);
      if (!previous || compareSections(section, previous) > 0) byId.set(section.id, section);
    }
    return [...byId.values()];
  }
  function sectionRank(section) {
    const rank = { groceries: 0, target: 1, costco: 2, lakehouse: 3 };
    return Object.prototype.hasOwnProperty.call(rank, section.id) ? rank[section.id] : 4;
  }
  function sortSections(values) {
    return normalizeSections(values).sort((a, b) => {
      const byRank = sectionRank(a) - sectionRank(b);
      if (byRank) return byRank;
      const byCreated = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      return byCreated || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
  }
  function mergeSections(localValues, remoteValues) {
    const byId = new Map();
    for (const section of [...normalizeSections(remoteValues), ...normalizeSections(localValues)]) {
      const previous = byId.get(section.id);
      if (!previous || compareSections(section, previous) > 0) byId.set(section.id, section);
    }
    return sortSections([...byId.values()]);
  }
  function isSectionDeleted(section) { return !!(section && section.deletedAt); }
  function visibleSections(values) { return sortSections(values).filter(section => !isSectionDeleted(section)); }
  function createSection(name, existingValues) {
    const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned.length > MAX_SECTION_NAME) throw new Error(`Enter a list name of 1–${MAX_SECTION_NAME} characters.`);
    const key = sectionTextKey(cleaned), id = sectionIdForName(cleaned);
    const existing = normalizeSections(existingValues).find(section => section.id === id || sectionTextKey(section.name) === key);
    if (existing && !isSectionDeleted(existing)) throw new Error(`“${existing.name}” already exists.`);
    const timestamp = existing ? nextISO(existing.updatedAt) : nowISO();
    return { id, name: cleaned, icon: existing ? existing.icon : '🧺', createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp };
  }
  function deleteSection(value) {
    const base = normalizeSection(value);
    if (!base) throw new Error('That shared list is invalid.');
    if (base.id === 'groceries') throw new Error('The Groceries list is the recipe-import destination and cannot be removed.');
    const timestamp = nowISO();
    return { ...base, updatedAt: timestamp, deletedAt: timestamp };
  }
  function legacyItemId(text, index) {
    const input = `${index}:${String(text || '').trim().toLocaleLowerCase()}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `legacy-${(hash >>> 0).toString(16)}-${index}`;
  }
  function normalizeItem(value, index = 0) {
    if (!value || typeof value !== 'object') return null;
    const text = String(value.text || '').trim();
    if (!text || text.length > MAX_TEXT) return null;
    const createdAt = cleanISO(value.createdAt) || cleanISO(value.updatedAt) || nowISO();
    const updatedAt = cleanISO(value.updatedAt) || createdAt;
    const id = typeof value.id === 'string' && value.id.trim() && value.id.length <= 160 ? value.id.trim() : legacyItemId(text, index);
    const sectionId = typeof value.sectionId === 'string' && value.sectionId.trim() && value.sectionId.length <= 160 ? value.sectionId.trim() : 'groceries';
    const item = { id, text, done: !!value.done, sectionId, createdAt, updatedAt };
    const deletedAt = cleanISO(value.deletedAt);
    if (deletedAt) item.deletedAt = deletedAt;
    return item;
  }
  function normalizeItems(values) {
    if (!Array.isArray(values)) return [];
    return values.slice(0, MAX_ITEMS).map((item, index) => normalizeItem(item, index)).filter(Boolean);
  }
  function createItem(text, sectionId = 'groceries') {
    const cleaned = String(text || '').trim();
    if (!cleaned || cleaned.length > MAX_TEXT) throw new Error(`Enter an item of ${MAX_TEXT} characters or fewer.`);
    const section = typeof sectionId === 'string' && sectionId.trim() && sectionId.length <= 160 ? sectionId.trim() : 'groceries';
    const timestamp = nowISO();
    return { id: makeId(), text: cleaned, done: false, sectionId: section, createdAt: timestamp, updatedAt: timestamp };
  }
  function updateItem(value, patch = {}) {
    const base = normalizeItem(value);
    if (!base) throw new Error('That grocery item is invalid.');
    const item = { ...base, ...patch, updatedAt: nowISO() };
    if (Object.prototype.hasOwnProperty.call(patch, 'deletedAt') && !patch.deletedAt) delete item.deletedAt;
    const normalized = normalizeItem(item);
    if (!normalized) throw new Error('That grocery item is invalid.');
    return normalized;
  }
  function deleteItem(value) {
    const timestamp = nowISO();
    return updateItem(value, { done: true, deletedAt: timestamp });
  }
  function isDeleted(item) { return !!(item && item.deletedAt); }
  function visibleItems(values) { return normalizeItems(values).filter(item => !isDeleted(item)); }
  function itemTextKey(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
  function compareItems(a, b) {
    const ta = Date.parse(a.updatedAt) || 0, tb = Date.parse(b.updatedAt) || 0;
    if (ta !== tb) return ta - tb;
    if (!!a.deletedAt !== !!b.deletedAt) return a.deletedAt ? 1 : -1;
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  }
  function mergeItems(localValues, remoteValues) {
    const byId = new Map();
    for (const item of [...normalizeItems(remoteValues), ...normalizeItems(localValues)]) {
      const previous = byId.get(item.id);
      if (!previous || compareItems(item, previous) > 0) byId.set(item.id, item);
    }
    const byText = new Map();
    for (const item of byId.values()) {
      const key = `${item.sectionId}\u001f${itemTextKey(item.text)}`;
      const previous = byText.get(key);
      if (!previous || compareItems(item, previous) > 0) byText.set(key, item);
    }
    return [...byText.values()].sort((a, b) => {
      const bySection = a.sectionId.localeCompare(b.sectionId);
      if (bySection) return bySection;
      const byCreated = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      return byCreated || a.text.localeCompare(b.text) || a.id.localeCompare(b.id);
    });
  }
  function comparableSections(values) {
    return sortSections(values).map(section => ({
      id: section.id, name: section.name, icon: section.icon, createdAt: section.createdAt,
      updatedAt: section.updatedAt, ...(section.deletedAt ? { deletedAt: section.deletedAt } : {})
    }));
  }
  function comparableItems(values) {
    return normalizeItems(values).sort((a, b) => a.id.localeCompare(b.id)).map(item => ({
      id: item.id, text: item.text, done: item.done, sectionId: item.sectionId,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(item.deletedAt ? { deletedAt: item.deletedAt } : {})
    }));
  }
  function sameSections(a, b) { return JSON.stringify(comparableSections(a)) === JSON.stringify(comparableSections(b)); }
  function sameItems(a, b) { return JSON.stringify(comparableItems(a)) === JSON.stringify(comparableItems(b)); }
  function normalizeBoard(sectionValues, itemValues) {
    const sections = mergeSections(sectionValues, initialSections());
    let items = mergeItems(itemValues, []);
    const sectionById = new Map(sections.map(section => [section.id, section]));
    let restored = sections.slice();
    items = items.map(item => {
      const section = sectionById.get(item.sectionId);
      if (!section) return isDeleted(item) ? item : updateItem(item, { sectionId: 'groceries' });
      if (isSectionDeleted(section) && !isDeleted(item)) {
        const revived = { ...section, updatedAt: nextISO(section.updatedAt) };
        delete revived.deletedAt;
        restored = mergeSections(restored, [revived]);
        sectionById.set(revived.id, revived);
      }
      return item;
    });
    return { sections: sortSections(restored), items: mergeItems(items, []) };
  }
  function mergeBoard(localSections, localItems, remoteSections, remoteItems) {
    return normalizeBoard(mergeSections(localSections, remoteSections), mergeItems(localItems, remoteItems));
  }
  function apiURL(repo) {
    const normalized = normalizeRepo(repo);
    if (!normalized) throw new Error('Enter a valid public GitHub data repository as owner/name.');
    const [owner, name] = normalized.split('/');
    return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${DATA_FILE}`;
  }
  function decodeBase64(value) {
    const binary = root.atob(String(value || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  function encodeBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return root.btoa(binary);
  }
  function makeHeaders(token) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
  function apiError(status) {
    if (status === 401) return new Error('GitHub rejected the token. Check that it is valid and has not expired.');
    if (status === 403) return new Error('GitHub denied the request. Check the token’s repository access and Contents permission, or try again later if GitHub is rate-limiting requests.');
    if (status === 404) return new Error('GitHub could not find the public repository or grocery.json. Check the owner/repository and make sure the data file exists.');
    return new Error(`GitHub returned an error (HTTP ${status}). Check the repository and token, then try again.`);
  }
  async function readRemote(repo, token) {
    if (typeof root.fetch !== 'function') throw new Error('This browser cannot contact GitHub.');
    const response = await root.fetch(apiURL(repo), { method: 'GET', headers: makeHeaders(token), cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) return { sha: null, sections: initialSections(), items: [], missing: true, legacy: false };
    if (!response.ok) throw apiError(response.status);
    if (!payload || typeof payload.content !== 'string' || payload.encoding !== 'base64') {
      throw new Error('The repository file is not a GitHub JSON file. Check that grocery.json is in the repository root.');
    }
    let document;
    try { document = JSON.parse(decodeBase64(payload.content)); }
    catch (_) { throw new Error('grocery.json is not valid UTF-8 JSON. Keep a copy, then repair it before syncing.'); }
    if (document && document.formatVersion === 1 && Array.isArray(document.items)) {
      return { sha: String(payload.sha || ''), sections: initialSections(), items: normalizeItems(document.items), missing: false, legacy: true };
    }
    if (!document || document.formatVersion !== FORMAT_VERSION || !Array.isArray(document.sections) || !Array.isArray(document.items)) {
      throw new Error('grocery.json has an unsupported format. Update both the Family Hub and phone Grocery pages before syncing.');
    }
    const sections = mergeSections(normalizeSections(document.sections), [initialSections()[0]]);
    return { sha: String(payload.sha || ''), sections, items: normalizeItems(document.items), missing: false, legacy: false };
  }
  async function writeRemote(repo, token, sha, sections, items) {
    const board = normalizeBoard(sections, items);
    const document = {
      app: APP_NAME,
      formatVersion: FORMAT_VERSION,
      updatedAt: nowISO(),
      sections: board.sections,
      items: board.items
    };
    const body = { message: 'Update shared grocery lists', content: encodeBase64(JSON.stringify(document, null, 2)) };
    if (sha) body.sha = sha;
    const response = await root.fetch(apiURL(repo), {
      method: 'PUT', headers: { ...makeHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) {
        const conflict = new Error('The grocery file changed on another device. Retrying with the latest copy.');
        conflict.conflict = true;
        throw conflict;
      }
      throw apiError(response.status);
    }
    return String(payload && payload.content && payload.content.sha || '');
  }
  async function syncBoard(localSectionValues, localItemValues) {
    const settings = getSettings();
    const token = getToken();
    let working = normalizeBoard(localSectionValues, localItemValues);
    if (!settings.repo) return { state: 'not_configured', ...working, sha: null };
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await readRemote(settings.repo, token);
      const merged = mergeBoard(working.sections, working.items, remote.sections, remote.items);
      const needsWrite = remote.missing || remote.legacy || !sameSections(merged.sections, remote.sections) || !sameItems(merged.items, remote.items);
      if (!needsWrite) return { state: token ? 'synced' : 'read_only', ...merged, sha: remote.sha, missing: false, legacy: false };
      if (!token) return { state: 'read_only', ...merged, sha: remote.sha, missing: remote.missing, legacy: remote.legacy };
      try {
        const sha = await writeRemote(settings.repo, token, remote.sha, merged.sections, merged.items);
        return { state: 'synced', ...merged, sha, missing: false, legacy: false };
      } catch (error) {
        if (!error.conflict || attempt === 3) throw error;
        working = merged;
      }
    }
    throw new Error('The grocery list kept changing. Wait a moment and sync again.');
  }
  async function syncItems(localValues) {
    const result = await syncBoard(initialSections(), normalizeItems(localValues));
    return { ...result, items: result.items };
  }

  root.GrocerySync = Object.freeze({
    dataFile: DATA_FILE, formatVersion: FORMAT_VERSION,
    getSettings, saveSettings, normalizeRepo, getToken, hasToken, tokenIsRemembered,
    setToken, clearToken, clearConnection,
    initialSections, normalizeSection, normalizeSections, visibleSections,
    createSection, deleteSection, isSectionDeleted, mergeSections, sameSections,
    normalizeItems, createItem, updateItem, deleteItem, isDeleted, visibleItems,
    mergeItems, sameItems, normalizeBoard, mergeBoard, readRemote, syncBoard, syncItems
  });
})(typeof window !== 'undefined' ? window : globalThis);
