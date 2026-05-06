// Owns the current filter state (theme + star-range), builds the active
// puzzle pool from the union, persists state to IDB meta, and provides
// next() with shuffle-and-cycle ordering.

const THEME_IDS = ['all', 'mateIn1', 'mateIn2', 'fork', 'pin', 'hangingPiece'];

export class Filters {
  constructor(store, allPuzzles) {
    this.store = store;
    this.allPuzzles = allPuzzles;
    this.theme = 'all';
    this.minStars = 1;
    this.maxStars = 2;
    this.pool = [];
    this.poolIndex = 0;
  }

  async load() {
    this.theme    = (await this.store.getMeta('filterTheme'))    ?? 'all';
    // Pre-range existing users persisted only filterMaxStars; default
    // filterMinStars to 1 so their pool is preserved exactly.
    this.minStars = (await this.store.getMeta('filterMinStars')) ?? 1;
    this.maxStars = (await this.store.getMeta('filterMaxStars')) ?? 2;
    this.rebuildPool();
    return this;
  }

  rebuildPool() {
    let pool = this.theme === 'all'
      ? this.allPuzzles
      : this.allPuzzles.filter((p) => p.themes.includes(this.theme));
    pool = pool.filter((p) => p.stars >= this.minStars && p.stars <= this.maxStars);
    this.pool = shuffle(pool);
    this.poolIndex = 0;
  }

  counts() {
    const out = {};
    for (const id of THEME_IDS) {
      const themed = id === 'all'
        ? this.allPuzzles
        : this.allPuzzles.filter((p) => p.themes.includes(id));
      out[id] = themed.filter(
        (p) => p.stars >= this.minStars && p.stars <= this.maxStars,
      ).length;
    }
    return out;
  }

  async setTheme(t) {
    this.theme = t;
    this.rebuildPool();
    await this.persist();
  }

  async setStarRange(min, max) {
    this.minStars = min;
    this.maxStars = max;
    this.rebuildPool();
    await this.persist();
  }

  next() {
    if (this.pool.length === 0) return null;
    if (this.poolIndex >= this.pool.length) {
      this.pool = shuffle(this.pool);
      this.poolIndex = 0;
    }
    return this.pool[this.poolIndex++];
  }

  async persist() {
    await Promise.all([
      this.store.setMeta('filterTheme',    this.theme),
      this.store.setMeta('filterMinStars', this.minStars),
      this.store.setMeta('filterMaxStars', this.maxStars),
    ]);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
