/* Shared Grocery list client. Uses GitHub's Contents API; tokens are entered by the user and are never part of the app files or family-data backups. */
(function (root) {
  'use strict';

  const SETTINGS_KEY = 'familyHubGrocerySyncSettingsV1';
  const SESSION_TOKEN_KEY = 'familyHubGrocerySyncTokenSessionV1';
  const REMEMBERED_TOKEN_KEY = 'familyHubGrocerySyncTokenRememberedV1';
  const API_BASE = 'https://api.github.com';
  const DATA_FILE = 'grocery.json';
  const APP_NAME = 'Hearthside Shared Grocery List';
  const FORMAT_VERSION = 1;
  const MAX_ITEMS = 10000;
  const MAX_TEXT = 500;

  function storageGet(storage, key) {
    try { return storage && storage.getItem(key); } catch (_) { return null; }
  }
  function storageSet(storage, key, value) {
    try { if (storage) storage.setItem(key, value); return true; } catch (_) { return false; }
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
  function legacyId(text, index) {
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
    const id = typeof value.id === 'string' && value.id.trim() && value.id.length <= 160 ? value.id.trim() : legacyId(text, index);
    const item = { id, text, done: !!value.done, createdAt, updatedAt };
    const deletedAt = cleanISO(value.deletedAt);
    if (deletedAt) item.deletedAt = deletedAt;
    return item;
  }
  function normalizeItems(values) {
    if (!Array.isArray(values)) return [];
    return values.slice(0, MAX_ITEMS).map((item, index) => normalizeItem(item, index)).filter(Boolean);
  }
  function createItem(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned || cleaned.length > MAX_TEXT) throw new Error(`Enter an item of ${MAX_TEXT} characters or fewer.`);
    const timestamp = nowISO();
    return { id: makeId(), text: cleaned, done: false, createdAt: timestamp, updatedAt: timestamp };
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
      const key = itemTextKey(item.text);
      const previous = byText.get(key);
      if (!previous || compareItems(item, previous) > 0) byText.set(key, item);
    }
    return [...byText.values()].sort((a, b) => {
      const byCreated = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      return byCreated || a.text.localeCompare(b.text) || a.id.localeCompare(b.id);
    });
  }
  function comparableItems(values) {
    return normalizeItems(values).sort((a, b) => a.id.localeCompare(b.id)).map(item => ({
      id: item.id, text: item.text, done: item.done, createdAt: item.createdAt,
      updatedAt: item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt } : {})
    }));
  }
  function sameItems(a, b) { return JSON.stringify(comparableItems(a)) === JSON.stringify(comparableItems(b)); }
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
    if (response.status === 404) return { sha: null, items: [], missing: true };
    if (!response.ok) throw apiError(response.status);
    if (!payload || typeof payload.content !== 'string' || payload.encoding !== 'base64') {
      throw new Error('The repository file is not a GitHub JSON file. Check that grocery.json is in the repository root.');
    }
    let document;
    try { document = JSON.parse(decodeBase64(payload.content)); }
    catch (_) { throw new Error('grocery.json is not valid UTF-8 JSON. Keep a copy, then repair it before syncing.'); }
    if (!document || document.formatVersion !== FORMAT_VERSION || !Array.isArray(document.items)) {
      throw new Error('grocery.json has an unsupported format. Use the provided Hearthside grocery-list template.');
    }
    return { sha: String(payload.sha || ''), items: normalizeItems(document.items), missing: false };
  }
  async function writeRemote(repo, token, sha, items) {
    const document = {
      app: APP_NAME,
      formatVersion: FORMAT_VERSION,
      updatedAt: nowISO(),
      items: normalizeItems(items)
    };
    const body = { message: 'Update shared grocery list', content: encodeBase64(JSON.stringify(document, null, 2)) };
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
  async function syncItems(localValues) {
    const settings = getSettings();
    const local = normalizeItems(localValues);
    if (!settings.repo) return { state: 'not_configured', items: local, sha: null };
    const token = getToken();
    let working = local;
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await readRemote(settings.repo, token);
      const merged = mergeItems(working, remote.items);
      const needsWrite = !remote.sha || !sameItems(merged, remote.items);
      if (!needsWrite) return { state: token ? 'synced' : 'read_only', items: merged, sha: remote.sha, missing: false };
      if (!token) return { state: 'read_only', items: merged, sha: remote.sha, missing: remote.missing };
      try {
        const sha = await writeRemote(settings.repo, token, remote.sha, merged);
        return { state: 'synced', items: merged, sha, missing: false };
      } catch (error) {
        if (!error.conflict || attempt === 3) throw error;
        working = merged;
      }
    }
    throw new Error('The grocery list kept changing. Wait a moment and sync again.');
  }

  root.GrocerySync = Object.freeze({
    dataFile: DATA_FILE,
    getSettings, saveSettings, normalizeRepo, getToken, hasToken, tokenIsRemembered,
    setToken, clearToken, clearConnection, normalizeItems, createItem, updateItem,
    deleteItem, isDeleted, visibleItems, mergeItems, sameItems, readRemote, syncItems
  });
})(typeof window !== 'undefined' ? window : globalThis);
