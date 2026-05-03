// src/stats.js
// Stats state machine. Tracks lifetime solved, current/best streak, today's
// count (with local-midnight rollover). Streak resets on first wrong move per
// puzzle; skip and show leave streak unchanged. Persisted via Store's meta API.

export class Stats {
  constructor(store) {
    this.store = store;
    this.solved = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.todayCount = 0;
    this.todayDate = todayKey();
    this.puzzleHadError = false;
  }

  async load() {
    this.solved      = (await this.store.getMeta('solved'))      ?? 0;
    this.streak      = (await this.store.getMeta('streak'))      ?? 0;
    this.bestStreak  = (await this.store.getMeta('bestStreak'))  ?? 0;
    const storedDate  = await this.store.getMeta('todayDate');
    const storedCount = (await this.store.getMeta('todayCount')) ?? 0;
    if (storedDate === todayKey()) {
      this.todayDate = storedDate;
      this.todayCount = storedCount;
    } else {
      this.todayDate = todayKey();
      this.todayCount = 0;
    }
    return this;
  }

  startPuzzle() {
    this.puzzleHadError = false;
  }

  async onCorrectSolve() {
    this.solved += 1;
    this.bumpToday();
    if (!this.puzzleHadError) {
      this.streak += 1;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    }
    this.puzzleHadError = false;
    await this.persist();
  }

  async onWrongMove() {
    if (!this.puzzleHadError) {
      this.streak = 0;
      this.puzzleHadError = true;
      await this.persist();
    }
  }

  async onSkipOrShow() {
    this.puzzleHadError = false;
  }

  bumpToday() {
    if (this.todayDate !== todayKey()) {
      this.todayDate = todayKey();
      this.todayCount = 0;
    }
    this.todayCount += 1;
  }

  async persist() {
    await Promise.all([
      this.store.setMeta('solved',     this.solved),
      this.store.setMeta('streak',     this.streak),
      this.store.setMeta('bestStreak', this.bestStreak),
      this.store.setMeta('todayDate',  this.todayDate),
      this.store.setMeta('todayCount', this.todayCount),
    ]);
  }

  snapshot() {
    return {
      solved:     this.solved,
      streak:     this.streak,
      bestStreak: this.bestStreak,
      today:      this.todayCount,
    };
  }
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
