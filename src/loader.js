// src/loader.js
// Orchestrates fetch + IndexedDB caching for puzzle data.
// Public API: loadPuzzles(theme, opts) → Promise<Puzzle[]>

import { Store } from './store.js';

export class LoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoaderError';
  }
}

const DEFAULT_BASE = '/data/puzzles';

export async function loadPuzzles(theme = 'mateIn1', opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const store = opts.store ?? await new Store().open();
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? 5000;
  const onProgress = opts.onProgress;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE;

  // Read cache.
  const [cachedPuzzles, localVersion] = await Promise.all([
    store.getAllPuzzles(),
    store.getVersion(),
  ]);

  // Try to fetch the manifest.
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

  // Need to (re)fetch the theme file.
  const themeMeta = index.themes.find((t) => t.name === theme);
  if (!themeMeta) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`theme '${theme}' not in manifest`);
  }

  let themeBytes, themeText;
  try {
    ({ bytes: themeBytes, text: themeText } = await fetchWithProgress(
      fetchFn,
      `${baseUrl}/${themeMeta.file}`,
      onProgress,
      fetchTimeoutMs,
    ));
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`failed to fetch theme: ${err.message}`);
  }

  // sha256-verify.
  const computedSha = await sha256Hex(themeBytes);
  if (computedSha.toLowerCase() !== themeMeta.sha256.toLowerCase()) {
    console.warn(
      `[loader] sha256 mismatch for ${themeMeta.file}: expected ${themeMeta.sha256}, got ${computedSha}. Keeping cached data.`,
    );
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError('downloaded theme failed integrity check');
  }

  // Parse and store.
  let parsed;
  try {
    parsed = JSON.parse(themeText);
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`theme JSON parse failed: ${err.message}`);
  }

  await store.replacePuzzles(theme, parsed.puzzles);
  await store.setVersion(index.version);
  await store.setLastFetch(Date.now());

  return parsed.puzzles;
}

// ───── helpers ─────

async function fetchJsonWithTimeout(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithProgress(fetchFn, url, onProgress, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('Content-Length')) || 0;

    // If the response body isn't a ReadableStream (e.g., in older test mocks),
    // fall back to arrayBuffer.
    if (!res.body || typeof res.body.getReader !== 'function') {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (onProgress) onProgress(buf.byteLength, buf.byteLength);
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
      if (onProgress) onProgress(loaded, total);
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
