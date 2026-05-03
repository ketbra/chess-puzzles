// src/store.js
// Promise-based IndexedDB wrapper. Two object stores:
//   meta:    keyPath 'key';  rows shaped { key, value }
//   puzzles: keyPath 'id';   rows are full puzzle objects
//
// The store uses the global `indexedDB`. In production this is the browser's
// native IDB; in tests, `fake-indexeddb/auto` replaces it before this module
// is imported.

import { openDB } from 'idb';

const DB_NAME = 'chess-puzzles';
const DB_VERSION = 1;

export class Store {
  constructor() {
    this.db = null;
  }

  async open() {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('puzzles')) {
          db.createObjectStore('puzzles', { keyPath: 'id' });
        }
      },
    });
    return this;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async getMeta(key) {
    const row = await this.db.get('meta', key);
    return row?.value;
  }

  async setMeta(key, value) {
    await this.db.put('meta', { key, value });
  }

  getVersion()  { return this.getMeta('version'); }
  setVersion(v) { return this.setMeta('version', v); }
  getLastFetch()  { return this.getMeta('lastFetch'); }
  setLastFetch(v) { return this.setMeta('lastFetch', v); }

  async getAllPuzzles() {
    return await this.db.getAll('puzzles');
  }

  // For Phase 2 (single theme): clear the entire puzzles store and insert all.
  // The `theme` parameter is reserved for Phase 3 multi-theme support.
  async replacePuzzles(theme, puzzles) {
    const tx = this.db.transaction('puzzles', 'readwrite');
    const store = tx.objectStore('puzzles');
    await store.clear();
    for (const p of puzzles) {
      await store.put(p);
    }
    await tx.done;
  }
}
