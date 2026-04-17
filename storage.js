// storage.js — persistent directory handle for the File System Access API.
// Chrome/Edge only; `showDirectoryPicker` is feature-detected elsewhere
// and falls back to the browser's default download.

(function (root) {
  const DB = 'p5export';
  const STORE = 'kv';
  const KEY = 'outDirHandle';
  const RECENT_KEY = 'recentProjects';
  const RECENT_MAX = 5;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kvGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kvSet(key, val) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function kvDel(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function isSupported() {
    return typeof root.showDirectoryPicker === 'function';
  }

  async function verifyPermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  async function chooseOutputDir() {
    if (!isSupported()) {
      throw new Error('This browser does not support folder picking (try Chrome/Edge).');
    }
    const handle = await root.showDirectoryPicker({ mode: 'readwrite' });
    await kvSet(KEY, handle);
    return handle;
  }

  async function getStoredHandle() {
    return (await kvGet(KEY)) || null;
  }

  // Returns the handle if one is stored AND permission is active.
  // Does not prompt; use ensureActiveDir() to request permission.
  async function getActiveDir() {
    const handle = await getStoredHandle();
    if (!handle) return null;
    const opts = { mode: 'readwrite' };
    const state = await handle.queryPermission(opts);
    return state === 'granted' ? handle : null;
  }

  async function ensureActiveDir() {
    const handle = await getStoredHandle();
    if (!handle) return null;
    const ok = await verifyPermission(handle);
    return ok ? handle : null;
  }

  async function clearOutputDir() {
    await kvDel(KEY);
  }

  // ---- Recent project folders (history) ---------------------------------

  async function getRecentProjects() {
    return (await kvGet(RECENT_KEY)) || [];
  }

  // Dedupe by FSA isSameEntry() — two handles can share a name but point at
  // different folders. Falls back to name match if the API is missing.
  async function sameEntry(a, b) {
    try {
      if (typeof a.isSameEntry === 'function') return await a.isSameEntry(b);
    } catch (_) {}
    return a.name === b.name;
  }

  async function addRecentProject(handle) {
    const list = await getRecentProjects();
    const filtered = [];
    for (const entry of list) {
      if (!entry || !entry.handle) continue;
      if (await sameEntry(entry.handle, handle)) continue;
      filtered.push(entry);
    }
    filtered.unshift({ name: handle.name, handle, lastUsed: Date.now() });
    await kvSet(RECENT_KEY, filtered.slice(0, RECENT_MAX));
  }

  async function removeRecentProject(handleOrName) {
    const target = typeof handleOrName === 'string' ? handleOrName : handleOrName.name;
    const list = await getRecentProjects();
    await kvSet(RECENT_KEY, list.filter((e) => e.name !== target));
  }

  async function clearRecentProjects() {
    await kvDel(RECENT_KEY);
  }

  async function writeBlobToDir(rootHandle, subfolder, filename, blob) {
    let dir = rootHandle;
    if (subfolder) {
      // Support nested paths like `project/20260417_103045`.
      const parts = String(subfolder).split('/').filter(Boolean);
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
    }
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { subfolder, filename };
  }

  root.P5ExportStorage = {
    isSupported,
    chooseOutputDir,
    getStoredHandle,
    getActiveDir,
    ensureActiveDir,
    clearOutputDir,
    writeBlobToDir,
    verifyPermission,
    getRecentProjects,
    addRecentProject,
    removeRecentProject,
    clearRecentProjects,
  };
})(window);
