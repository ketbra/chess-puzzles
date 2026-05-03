// src/settings.js
// Settings state + IDB persistence. Mirrors the Stats/Filters pattern.

export class Settings {
  constructor(store) {
    this.store = store;
    this.soundOn = false;
    this.theme = 'warm';
    this.showCoords = false;
  }

  async load() {
    this.soundOn    = (await this.store.getMeta('soundOn'))    ?? false;
    this.theme      = (await this.store.getMeta('theme'))      ?? 'warm';
    this.showCoords = (await this.store.getMeta('showCoords')) ?? false;
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

  apply() {
    document.body.classList.toggle('theme-cool', this.theme === 'cool');
    document.body.classList.toggle('show-coords', !!this.showCoords);
  }

  snapshot() {
    return { soundOn: this.soundOn, theme: this.theme, showCoords: this.showCoords };
  }
}
