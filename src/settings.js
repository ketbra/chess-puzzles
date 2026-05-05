// src/settings.js
// Settings state + IDB persistence. Mirrors the Stats/Filters pattern.

export class Settings {
  constructor(store) {
    this.store = store;
    this.soundOn = false;
    this.theme = 'warm';
    this.showCoords = false;
    this.aidLegalMoves = true;   // Phase 6.3: legal-move dots default ON.
    this.aidKingEscape = false;  // Phase 6.3: king-escape default OFF (opt-in).
  }

  async load() {
    this.soundOn       = (await this.store.getMeta('soundOn'))       ?? false;
    this.theme         = (await this.store.getMeta('theme'))         ?? 'warm';
    this.showCoords    = (await this.store.getMeta('showCoords'))    ?? false;
    this.aidLegalMoves = (await this.store.getMeta('aidLegalMoves')) ?? true;
    this.aidKingEscape = (await this.store.getMeta('aidKingEscape')) ?? false;
    return this;
  }

  async setSound(on) {
    this.soundOn = !!on;
    await this.store.setMeta('soundOn', this.soundOn);
  }

  async setTheme(t) {
    this.theme = t;
    await this.store.setMeta('theme', this.theme);
  }

  async setShowCoords(on) {
    this.showCoords = !!on;
    await this.store.setMeta('showCoords', this.showCoords);
  }

  async setAidLegalMoves(on) {
    this.aidLegalMoves = !!on;
    await this.store.setMeta('aidLegalMoves', this.aidLegalMoves);
  }

  async setAidKingEscape(on) {
    this.aidKingEscape = !!on;
    await this.store.setMeta('aidKingEscape', this.aidKingEscape);
  }

  apply() {
    document.body.classList.toggle('theme-cool', this.theme === 'cool');
    document.body.classList.toggle('show-coords', !!this.showCoords);
  }

  snapshot() {
    return {
      soundOn: this.soundOn,
      theme: this.theme,
      showCoords: this.showCoords,
      aidLegalMoves: this.aidLegalMoves,
      aidKingEscape: this.aidKingEscape,
    };
  }
}
