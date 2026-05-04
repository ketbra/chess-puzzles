// src/profile.js
// Profiles class manages the active profile and the profile list, persisting
// via the Store's new profiles + profile_meta object stores.
//
// ProfileScopedStore wraps Store so existing modules (Stats, Filters,
// Settings) call getMeta/setMeta unchanged; the wrapper routes those calls
// to the active profile's compound-keyed rows in profile_meta.

const PALETTE = ['#f0d9b5', '#a8b8c4', '#b8cfb0', '#e8b89c', '#c9b4d8'];

export class Profiles {
  constructor(store) {
    this.store = store;
    this.profiles = [];
    this.activeId = null;
  }

  async load() {
    this.profiles = await this.store.listProfiles();
    this.activeId = await this.store.getMeta('activeProfileId');
    if (!this.activeId && this.profiles.length > 0) {
      this.activeId = this.profiles[0].id;
      await this.store.setMeta('activeProfileId', this.activeId);
    }
    return this;
  }

  list()   { return this.profiles.slice(); }
  active() { return this.profiles.find((p) => p.id === this.activeId) ?? null; }

  async create(name) {
    const trimmed = (name || '').trim().slice(0, 20) || 'New Player';
    const usedColors = new Set(this.profiles.map((p) => p.color));
    const color = PALETTE.find((c) => !usedColors.has(c)) ?? PALETTE[this.profiles.length % PALETTE.length];
    const profile = { id: cryptoRandomId(), name: trimmed, color, createdAt: Date.now() };
    await this.store.putProfile(profile);
    this.profiles.push(profile);
    return profile;
  }

  async rename(id, name) {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return;
    const trimmed = (name || '').trim().slice(0, 20);
    profile.name = trimmed || profile.name;
    await this.store.putProfile(profile);
  }

  async remove(id) {
    if (this.profiles.length <= 1) throw new Error('Cannot delete the only profile');
    if (id === this.activeId)       throw new Error('Cannot delete the active profile');
    await this.store.deleteProfile(id);
    this.profiles = this.profiles.filter((p) => p.id !== id);
  }

  async setActive(id) {
    if (!this.profiles.some((p) => p.id === id)) throw new Error('Unknown profile id');
    this.activeId = id;
    await this.store.setMeta('activeProfileId', id);
  }
}

export class ProfileScopedStore {
  constructor(store, profileId) {
    this.store = store;
    this.profileId = profileId;
  }

  async getMeta(key) {
    return await this.store.getProfileMeta(this.profileId, key);
  }
  async setMeta(key, value) {
    return await this.store.setProfileMeta(this.profileId, key, value);
  }

  getAllPuzzles() { return this.store.getAllPuzzles(); }
  replacePuzzles(...args) { return this.store.replacePuzzles(...args); }
  getVersion()    { return this.store.getVersion(); }
  setVersion(v)   { return this.store.setVersion(v); }
  getLastFetch()  { return this.store.getLastFetch(); }
  setLastFetch(v) { return this.store.setLastFetch(v); }
}

function cryptoRandomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
