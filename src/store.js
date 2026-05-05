// src/store.js
// Promise-based IndexedDB wrapper. Four object stores:
//   meta:         keyPath 'key';              rows shaped { key, value }
//   puzzles:      keyPath 'id';               rows are full puzzle objects
//   profiles:     keyPath 'id';               rows are profile objects
//   profile_meta: keyPath ['profileId','key']; rows shaped { profileId, key, value }
//
// The store uses the global `indexedDB`. In production this is the browser's
// native IDB; in tests, `fake-indexeddb/auto` replaces it before this module
// is imported.

import { openDB } from 'idb';

const DB_NAME = 'chess-puzzles';
const DB_VERSION = 2;

const PER_PROFILE_KEYS = [
  'solved', 'streak', 'bestStreak', 'todayCount', 'todayDate',
  'filterTheme', 'filterMaxStars',
  'soundOn', 'theme', 'showCoords',
  'aidLegalMoves', 'aidKingEscape',
];

const FIRST_PALETTE_COLOR = '#f0d9b5';

export class Store {
  constructor() {
    this.db = null;
  }

  async open() {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('meta',    { keyPath: 'key' });
          db.createObjectStore('puzzles', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('profiles',     { keyPath: 'id' });
          db.createObjectStore('profile_meta', { keyPath: ['profileId', 'key'] });
        }
      },
    });
    await this.maybeRunMigration();
    return this;
  }

  async maybeRunMigration() {
    const profilesCount = await this.db.count('profiles');
    if (profilesCount > 0) return;

    const tx = this.db.transaction(['meta', 'profiles', 'profile_meta'], 'readwrite');
    const metaStore = tx.objectStore('meta');
    const profilesStore = tx.objectStore('profiles');
    const profileMetaStore = tx.objectStore('profile_meta');

    const profile = {
      id: cryptoRandomId(),
      name: 'Player 1',
      color: FIRST_PALETTE_COLOR,
      createdAt: Date.now(),
    };
    await profilesStore.put(profile);
    await metaStore.put({ key: 'activeProfileId', value: profile.id });

    for (const key of PER_PROFILE_KEYS) {
      const row = await metaStore.get(key);
      if (row && row.value !== undefined) {
        await profileMetaStore.put({ profileId: profile.id, key, value: row.value });
        await metaStore.delete(key);
      }
    }
    await tx.done;
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
  // The `_theme` parameter is reserved for Phase 3 multi-theme support.
  async replacePuzzles(_theme, puzzles) {
    const tx = this.db.transaction('puzzles', 'readwrite');
    const store = tx.objectStore('puzzles');
    await store.clear();
    for (const p of puzzles) {
      await store.put(p);
    }
    await tx.done;
  }

  // ───────── Profile-related methods ─────────

  async listProfiles() {
    return await this.db.getAll('profiles');
  }

  async putProfile(profile) {
    await this.db.put('profiles', profile);
  }

  async deleteProfile(id) {
    const tx = this.db.transaction(['profiles', 'profile_meta'], 'readwrite');
    await tx.objectStore('profiles').delete(id);
    const pmStore = tx.objectStore('profile_meta');
    let cursor = await pmStore.openCursor();
    while (cursor) {
      if (cursor.value.profileId === id) await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async getProfileMeta(profileId, key) {
    const row = await this.db.get('profile_meta', [profileId, key]);
    return row?.value;
  }

  async setProfileMeta(profileId, key, value) {
    await this.db.put('profile_meta', { profileId, key, value });
  }
}

function cryptoRandomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
