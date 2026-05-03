# Phase 6.1 Design: Multi-profile

**Date:** 2026-05-03
**Phase:** 6.1 of 6 (first sub-project of Phase 6 stretch features per `PROJECT.md`)
**Predecessors:**
- Phases 1–5 shipped (designs in `docs/superpowers/specs/`)

**Goal:** Let multiple kids share the device with isolated stats, streaks, filter preferences, and settings. After this phase, each kid has their own profile with a name and color avatar; switching profiles is one tap away in the settings sheet.

This is the first of four Phase 6 stretch sub-projects (multi-profile, adaptive difficulty, per-theme stats, daily-streak calendar). Each gets its own design + plan + implementation cycle.

---

## Scope

### In scope

**Profile data model.**

- Each profile: `{ id, name, color, createdAt }` where `id` is a 32-hex-char random id, `name` is a 1–20-char string, `color` is a hex string from a 5-entry palette, `createdAt` is a millisecond timestamp.
- Open-ended: kids (or parents) can add and delete profiles freely.
- Auto-assigned color from a 5-color palette, round-robin: cream `#f0d9b5`, slate-blue `#a8b8c4`, mint `#b8cfb0`, peach `#e8b89c`, lavender `#c9b4d8`.

**IDB schema upgrade (v1 → v2).**

- Two new object stores:
  - `profiles` keyed by `id` — full profile records.
  - `profile_meta` with compound keyPath `[profileId, key]` — value `{ profileId, key, value }`.
- Existing `meta` store keeps only **global** keys: `version`, `lastFetch`, `activeProfileId`. All previously-flat per-profile keys move into `profile_meta`:
  - `solved`, `streak`, `bestStreak`, `todayCount`, `todayDate`
  - `filterTheme`, `filterMaxStars`
  - `soundOn`, `theme`, `showCoords`

**One-time data migration.**

- On the first `Store.open()` after the v1→v2 upgrade, an idempotent migration step runs in a normal transaction (after the upgrade transaction closes):
  1. Detect: `profiles` count is zero AND `meta` may have per-profile keys.
  2. Auto-create a single profile named `"Player 1"` with the first palette color.
  3. Write `meta.activeProfileId = newProfile.id`.
  4. For each per-profile key in the static list, move the row from `meta` into `profile_meta` under the new profile.
- Migration is detected by `profiles.count() === 0`. Re-running is safe (no-ops).
- Fresh installs hit the same path: Player 1 is created with no carry-over data.

**Profile module (`src/profile.js`).**

- `Profiles` class — owns the in-memory list and the active id. Methods:
  - `load()` — reads from store, returns `this`.
  - `list()` — returns shallow copy of profiles.
  - `active()` — returns the active profile object or null.
  - `create(name)` — creates new profile with auto color; persists.
  - `rename(id, name)` — updates name (trimmed, ≤20 chars; falls back to existing if empty).
  - `remove(id)` — deletes profile + all `profile_meta` rows for it. Throws if `id` is the only or active profile.
  - `setActive(id)` — sets active id; persists `meta.activeProfileId`. Caller is responsible for any reload.
- `ProfileScopedStore` wrapper — same shape as `Store` so `Stats` / `Filters` / `Settings` need zero changes:
  - `getMeta(key)` → routes to `store.getProfileMeta(this.profileId, key)`.
  - `setMeta(key, value)` → routes to `store.setProfileMeta(this.profileId, key, value)`.
  - Pass-through: `getAllPuzzles`, `replacePuzzles`, `getVersion`, `setVersion`, `getLastFetch`, `setLastFetch`.

**Profile UI in the settings sheet.**

- New "Profile" section above the existing Sound row:
  - Active row: avatar (color circle with initial) + name + chevron + ✏ rename button.
  - Tap the active row to expand the switcher panel.
- Switcher panel (initially hidden):
  - List of all profiles with avatar + name + Switch button + 🗑 delete button per row (delete hidden on the active row).
  - "+ Add profile" button at the bottom.
- Adding a profile uses `prompt()` for the name. New profile is created, set active, and the page reloads.
- Switching profile reloads the page (simplest path; guaranteed clean state).
- Renaming uses `prompt()` with the current name pre-filled. No reload (settings sheet re-renders).
- Deleting uses `confirm()`; throws an alert if user attempts to delete the only or active profile.

**Switch / Add semantics.**

- "Switch profile" or "Add profile" both call `setActive(id)` and then `window.location.reload()`. Full reload was chosen over runtime re-instantiation because the latter would require tearing down and rebuilding `Stats`, `Filters`, `Settings`, the puzzle queue, and re-rendering every UI surface — far more code surface than the simplicity-of-reload trade-off justifies.

**Out of scope (deferred or rejected).**

| Feature | Phase / decision |
|---|---|
| Adaptive difficulty | Phase 6.2 |
| Per-theme stats view | Phase 6.3 |
| Daily streak calendar | Phase 6.4 |
| Cross-profile stats comparison view | not planned |
| Cloud sync of profiles | not planned |
| Parental lock on profile delete | not planned |
| Profile photos / custom avatars | not planned (color circle is sufficient) |
| Per-profile custom palette colors | not planned (round-robin is sufficient) |

### Persistence keys after this phase

- `meta` store (global): `version`, `lastFetch`, `activeProfileId`.
- `profiles` store (global): one row per profile.
- `profile_meta` store (per-profile, compound key): `solved`, `streak`, `bestStreak`, `todayCount`, `todayDate`, `filterTheme`, `filterMaxStars`, `soundOn`, `theme`, `showCoords`.

---

## File changes

| Action | Path | Notes |
|---|---|---|
| Modify | `src/store.js` | DB version bump to v2; new stores; v1→v2 upgrade; `maybeRunMigration`; new methods `listProfiles`, `putProfile`, `deleteProfile`, `getProfileMeta`, `setProfileMeta` |
| Create | `src/profile.js` | `Profiles` class + `ProfileScopedStore` wrapper |
| Create | `tests/profile.test.js` | Profiles CRUD + ProfileScopedStore round-trip + migration |
| Modify | `tests/store.test.js` | Verify v2 schema; add migration test |
| Create | `src/ui/profile.js` | Profile section render + switcher panel |
| Modify | `src/ui/settings.js` | Accept `profiles` param; call `bindProfileSection` |
| Modify | `src/app.js` | Construct `Profiles` first, then `ProfileScopedStore`, then `Stats` / `Filters` / `Settings` with the scoped store; pass `profiles` to `bindSettings` |
| Modify | `index.html` | Profile section markup at top of settings sheet + switcher panel |
| Modify | `src/ui/styles.css` | Profile chip + avatar + switcher styles |
| Modify | `sw.js` | Add `src/profile.js` and `src/ui/profile.js` to APP_SHELL; bump SW_VERSION to v5 |

---

## Store schema upgrade

DB name unchanged (`chess-puzzles`). Version bumps from 1 to 2.

```js
const DB_NAME = 'chess-puzzles';
const DB_VERSION = 2;

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

  const PER_PROFILE_KEYS = [
    'solved', 'streak', 'bestStreak', 'todayCount', 'todayDate',
    'filterTheme', 'filterMaxStars',
    'soundOn', 'theme', 'showCoords',
  ];

  const tx = this.db.transaction(['meta', 'profiles', 'profile_meta'], 'readwrite');
  const metaStore = tx.objectStore('meta');
  const profilesStore = tx.objectStore('profiles');
  const profileMetaStore = tx.objectStore('profile_meta');

  const profile = {
    id: cryptoRandomId(),
    name: 'Player 1',
    color: '#f0d9b5',
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

function cryptoRandomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

`Store` gains the following new methods:

```js
async listProfiles() {
  return this.db.getAll('profiles');
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
```

---

## `Profiles` and `ProfileScopedStore` (`src/profile.js`)

```js
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
```

---

## App.js wiring

```js
const store = await new Store().open();          // runs upgrade + migration if needed
const profiles = await new Profiles(store).load();
const active = profiles.active();                // never null after load (migration creates Player 1)
const scopedStore = new ProfileScopedStore(store, active.id);

stats    = await new Stats(scopedStore).load();
filters  = await new Filters(scopedStore, puzzles).load();
settings = await new Settings(scopedStore).load();

// ... existing render calls and bindSettings ...
bindSettings({
  settings,
  profiles,
  onResetStats: async () => {
    await stats.reset();
    renderStats(stats.snapshot());
  },
});
```

`Stats`, `Filters`, `Settings` keep using their existing `getMeta` / `setMeta` calls — they just get scoped to the active profile transparently via `ProfileScopedStore`.

---

## UI: profile section in settings sheet

### Markup additions to `index.html`

Inside the existing `<div id="settings-sheet">`, add as the **first** rows (before the existing Sound row):

```html
<!-- Active profile row + edit affordance -->
<div class="setting-row profile-row">
  <button id="profile-active" type="button" class="profile-active" aria-label="Switch profile">
    <span id="profile-active-avatar" class="profile-avatar"></span>
    <span id="profile-active-name" class="profile-active-name"></span>
    <span class="profile-active-chevron">›</span>
  </button>
  <button id="profile-rename" type="button" class="profile-rename" aria-label="Rename profile">✏</button>
</div>

<!-- Expandable switcher panel; toggled from #profile-active -->
<div id="profile-switcher" class="profile-switcher" hidden>
  <div id="profile-list" class="profile-list"></div>
  <button id="profile-add" type="button" class="profile-add">+ Add profile</button>
</div>
```

### `src/ui/profile.js`

```js
export function bindProfileSection({ profiles }) {
  const activeRow    = document.querySelector('#profile-active');
  const activeAvatar = document.querySelector('#profile-active-avatar');
  const activeName   = document.querySelector('#profile-active-name');
  const renameBtn    = document.querySelector('#profile-rename');
  const switcher     = document.querySelector('#profile-switcher');
  const listEl       = document.querySelector('#profile-list');
  const addBtn       = document.querySelector('#profile-add');

  renderActive();
  renderList();

  activeRow.addEventListener('click', () => {
    switcher.hidden = !switcher.hidden;
  });

  renameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const cur = profiles.active();
    if (!cur) return;
    const next = prompt('Rename profile:', cur.name);
    if (next == null) return;
    await profiles.rename(cur.id, next);
    renderActive();
    renderList();
  });

  addBtn.addEventListener('click', async () => {
    const name = prompt('What’s your name?');
    if (name == null) return;
    const profile = await profiles.create(name);
    await profiles.setActive(profile.id);
    window.location.reload();
  });

  function renderActive() {
    const cur = profiles.active();
    if (!cur) return;
    activeName.textContent = cur.name;
    paintAvatar(activeAvatar, cur);
  }

  function renderList() {
    listEl.replaceChildren(...profiles.list().map((p) => makeRow(p)));
  }

  function makeRow(p) {
    const row = document.createElement('div');
    row.className = 'profile-row-item' + (p.id === profiles.active()?.id ? ' is-active' : '');
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    paintAvatar(avatar, p);
    const name = document.createElement('span');
    name.className = 'profile-row-name';
    name.textContent = p.name;
    row.append(avatar, name);

    if (p.id !== profiles.active()?.id) {
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'profile-switch';
      switchBtn.textContent = 'Switch';
      switchBtn.addEventListener('click', async () => {
        await profiles.setActive(p.id);
        window.location.reload();
      });
      row.appendChild(switchBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'profile-delete';
      delBtn.setAttribute('aria-label', `Delete ${p.name}`);
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete ${p.name}? Their stats will be lost.`)) return;
        try {
          await profiles.remove(p.id);
          renderList();
        } catch (err) {
          alert(err.message);
        }
      });
      row.appendChild(delBtn);
    }

    return row;
  }

  function paintAvatar(el, p) {
    el.textContent = (p.name || '?').charAt(0).toUpperCase();
    el.style.background = p.color;
  }
}
```

### `src/ui/settings.js` change

Add `import { bindProfileSection } from './profile.js';` and accept `profiles` in the destructured options:

```js
export function bindSettings({ settings, profiles, onResetStats }) {
  // existing body unchanged...
  bindProfileSection({ profiles });
  // existing body unchanged...
}
```

### CSS additions (`src/ui/styles.css`)

```css
/* Profile section in settings sheet */
.profile-row {
  align-items: center;
  gap: 8px;
}

.profile-active {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  background: transparent;
  border: none;
  color: #efe6dc;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.profile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-weight: 600;
  color: #2a201a;
  background: #f0d9b5;
  flex: 0 0 auto;
}

.profile-active-name {
  flex: 1;
  font-weight: 600;
}

.profile-active-chevron {
  color: #b88550;
  font-size: 18px;
}

.profile-rename {
  background: transparent;
  border: none;
  color: #efe6dc;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}

.profile-switcher {
  margin-top: 8px;
  border-top: 1px solid #4a3525;
  padding-top: 8px;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-row-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-radius: 8px;
}

.profile-row-item.is-active {
  background: #4a3525;
}

.profile-row-name {
  flex: 1;
  font-size: 15px;
}

.profile-switch,
.profile-delete {
  background: transparent;
  border: 2px solid #5a3a22;
  color: #efe6dc;
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}

.profile-delete {
  border-color: #a85a3c;
  padding: 4px 8px;
}

.profile-add {
  margin-top: 8px;
  width: 100%;
  min-height: 40px;
  background: #2a201a;
  border: 2px solid #5a3a22;
  color: #efe6dc;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
}
```

---

## Test plan

| File | Group | Tests |
|---|---|---|
| `tests/profile.test.js` | empty start | `Profiles().load()` after migration: list contains one profile (Player 1), `activeId` is set |
| `tests/profile.test.js` | create | `create("Alice")` adds a profile, returns it; `list()` includes it |
| `tests/profile.test.js` | name validation | trims; truncates to 20 chars; falls back to `'New Player'` for empty/whitespace |
| `tests/profile.test.js` | rename | `rename(id, "Bob")` updates name; falls back to existing name on empty input |
| `tests/profile.test.js` | color round-robin | first 5 profiles get distinct palette colors; 6th cycles |
| `tests/profile.test.js` | setActive | `setActive(id)` updates `activeId` and persists `activeProfileId` |
| `tests/profile.test.js` | remove forbids only | `remove(id)` throws if profiles.length === 1 |
| `tests/profile.test.js` | remove forbids active | `remove(activeId)` throws |
| `tests/profile.test.js` | remove cascades | with profile A having stored meta, after `remove(A.id)` no `profile_meta` rows remain for A |
| `tests/profile.test.js` | ProfileScopedStore round-trip | scoped getMeta returns what scoped setMeta wrote; isolated per profile |
| `tests/profile.test.js` | ProfileScopedStore puzzle pass-through | scoped store delegates puzzle methods to underlying Store |
| `tests/store.test.js` (new) | v1→v2 migration | seed v1 IDB with flat meta keys, open Store at v2, expect Player 1 created with those keys moved into `profile_meta` |
| `tests/store.test.js` (new) | v2 schema | after open, `profiles` and `profile_meta` stores exist; `meta` still exists |

Approximate new test count: ~13. Target total: 116 + 13 = 129.

---

## Manual test plan

1. **Migration on existing data.** With existing Phase-5 IDB state (stats / settings / filters), reload after this update. App shows the same stats, theme, filter prefs as before. Open settings → "Player 1" appears at the top with auto-assigned cream avatar. Stats unchanged.
2. **Rename.** Tap ✏ next to "Player 1". Type the kid's actual name. Save. Settings sheet updates.
3. **Add second profile.** Tap row → "+ Add profile" → enter name. Page reloads under the new profile. Stats header shows zero. Theme / sound / coords reset to defaults (new profile, no settings yet).
4. **Switch back to Player 1.** Open settings → tap row → "Switch" next to Player 1. Page reloads. Stats and settings restored.
5. **Add third profile.** Repeat. Each gets a different palette color avatar.
6. **Delete a profile.** From a different active profile, tap 🗑 next to a non-active profile. Confirm. Profile removed. Cannot delete the active or only-remaining profile (alert blocks).
7. **Persistence across reloads.** Reload the app. Active profile preserved.
8. **Sound + theme + coords are per-profile.** Set sound on for Player A, theme cool. Switch to Player B. Sound off, theme warm.
9. **Stats are per-profile.** Solve puzzles as A → solved count rises for A only. Switch to B → solved count is independent.
10. **Filter prefs are per-profile.** A picks Fork + 5 stars; B picks All + 2 stars. Each is restored on switch.
11. **Sound / confetti / reduced-motion behavior unchanged within a profile** (regression check from Phase 5).

---

## Definition of done

- [ ] All unit tests pass (~129 total).
- [ ] Existing single-profile users see their data preserved after the update (verified via migration test).
- [ ] Add / rename / delete / switch profile all work via the settings sheet.
- [ ] Stats, settings, and filter prefs are independent across profiles.
- [ ] The active profile cannot be deleted; the only-remaining profile cannot be deleted.
- [ ] Profile color avatars cycle through the five-color palette.
- [ ] No console errors in normal operation.
- [ ] SW APP_SHELL list updated; SW_VERSION bumped to v5 so the new `profile.js` modules precache.

---

## Architecture trade-offs explicitly considered

- **`ProfileScopedStore` wrapper vs rewriting Stats/Filters/Settings.** Wrapper. Existing classes don't change at all; they call `getMeta` / `setMeta` blindly and the wrapper routes to the per-profile compound key.
- **Switch profile = full reload vs runtime re-instantiation.** Reload. Simpler, guaranteed-clean state, only happens on deliberate user action.
- **Auto-create "Player 1" on migration vs first-launch wizard.** Auto-create with rename affordance. Faster first run after the update; the kid sees their data still there and renames at leisure.
- **Compound keypath `[profileId, key]` vs string-prefixed keys.** Compound. Cleaner deletes (cursor + match) and clearer schema; small one-time DB version bump cost.
- **Five-color palette round-robin vs free color picker.** Round-robin. Less UI; visually consistent; if the kid really wants a different color they can delete and recreate.
- **`prompt()` / `confirm()` / `alert()` for rename / delete / errors.** Native dialogs, no custom modal. Fine for kid-side polish; can be upgraded later if it feels janky.
- **No active-profile lockout / parental code.** Out of scope. Trust model is "kid taps own profile."
- **Migration runs in a normal transaction after the upgrade transaction.** The upgrade transaction in `idb` doesn't easily allow read-then-write across stores during the upgrade callback. Doing it in a regular transaction immediately after `openDB` resolves keeps the upgrade clean and the migration testable in isolation.
