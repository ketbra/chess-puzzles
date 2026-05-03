// src/loader.js
// Orchestrates fetch + IndexedDB caching for puzzle data across all themes.
// Public API: loadPuzzles(opts) → Promise<Puzzle[]> — returns the deduplicated
// union of all themes in the index.json manifest.

import { Store } from './store.js';

export class LoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoaderError';
  }
}

const DEFAULT_BASE = '/data/puzzles';

export async function loadPuzzles(opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const store = opts.store ?? await new Store().open();
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? 5000;
  const onProgress = opts.onProgress;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE;

  const [cachedPuzzles, localVersion] = await Promise.all([
    store.getAllPuzzles(),
    store.getVersion(),
  ]);

  let index;
  try {
    index = await fetchJsonWithTimeout(fetchFn, `${baseUrl}/index.json`, fetchTimeoutMs);
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`first launch requires network: ${err.message}`);
  }

  if (index.version === localVersion && cachedPuzzles.length > 0) {
    return cachedPuzzles;
  }

  // Fetch all themes in parallel.
  let totalLoaded = 0;
  const reportProgress = () => onProgress && onProgress(totalLoaded, 0);

  const fetched = [];
  try {
    const themePromises = index.themes.map(async (themeMeta) => {
      const { bytes, text } = await fetchWithProgress(
        fetchFn,
        `${baseUrl}/${themeMeta.file}`,
        (delta) => {
          totalLoaded += delta;
          reportProgress();
        },
        fetchTimeoutMs,
      );
      return { theme: themeMeta.name, bytes, text, expectedSha: themeMeta.sha256 };
    });
    const results = await Promise.all(themePromises);
    fetched.push(...results);
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`failed to fetch one or more themes: ${err.message}`);
  }

  // Verify every theme's sha256 BEFORE writing anything.
  for (const f of fetched) {
    const computed = await sha256Hex(f.bytes);
    if (computed.toLowerCase() !== f.expectedSha.toLowerCase()) {
      console.warn(
        `[loader] sha256 mismatch for ${f.theme}.json: expected ${f.expectedSha}, got ${computed}. Keeping cached data.`,
      );
      if (cachedPuzzles.length > 0) return cachedPuzzles;
      throw new LoaderError(`theme '${f.theme}' failed integrity check`);
    }
  }

  // Parse every theme.
  const allPuzzles = [];
  for (const f of fetched) {
    let parsed;
    try {
      parsed = JSON.parse(f.text);
    } catch (err) {
      if (cachedPuzzles.length > 0) return cachedPuzzles;
      throw new LoaderError(`theme '${f.theme}' JSON parse failed: ${err.message}`);
    }
    if (Array.isArray(parsed.puzzles)) {
      for (const p of parsed.puzzles) allPuzzles.push(p);
    }
  }

  await store.replacePuzzles('all', allPuzzles);
  await store.setVersion(index.version);
  await store.setLastFetch(Date.now());

  return await store.getAllPuzzles();
}

// ───── helpers ─────

async function fetchJsonWithTimeout(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // cache: 'no-cache' forces revalidation against the server so a stale
    // browser-cached manifest can't keep us serving outdated theme lists.
    // The theme files themselves are content-addressed via sha256, so caching
    // them is fine.
    const res = await fetchFn(url, { signal: controller.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithProgress(fetchFn, url, onChunk, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (!res.body || typeof res.body.getReader !== 'function') {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (onChunk) onChunk(buf.byteLength);
      return { bytes: buf, text: new TextDecoder().decode(buf) };
    }

    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (onChunk) onChunk(value.byteLength);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    return { bytes, text: new TextDecoder().decode(bytes) };
  } finally {
    clearTimeout(timer);
  }
}

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
