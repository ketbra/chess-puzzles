import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Stats } from '../src/stats.js';
import { Store } from '../src/store.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
});

async function freshStatsStore() {
  const store = await new Store().open();
  const stats = await new Stats(store).load();
  return { store, stats };
}

describe('Stats', () => {
  it('initializes with zeros on a fresh DB', async () => {
    const { stats } = await freshStatsStore();
    expect(stats.snapshot()).toMatchObject({ solved: 0, streak: 0, bestStreak: 0, today: 0 });
  });

  it('clean solve increments solved, streak, bestStreak, today', async () => {
    const { stats } = await freshStatsStore();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    expect(stats.snapshot()).toMatchObject({ solved: 1, streak: 1, bestStreak: 1, today: 1 });
  });

  it('two clean solves in a row: streak = 2', async () => {
    const { stats } = await freshStatsStore();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    expect(stats.snapshot()).toMatchObject({ solved: 2, streak: 2, bestStreak: 2, today: 2 });
  });

  it('wrong move resets streak to 0; subsequent solve does NOT increment streak', async () => {
    const { stats } = await freshStatsStore();
    for (let i = 0; i < 3; i++) {
      stats.startPuzzle();
      await stats.onCorrectSolve();
    }
    expect(stats.snapshot().streak).toBe(3);
    expect(stats.snapshot().bestStreak).toBe(3);

    stats.startPuzzle();
    await stats.onWrongMove();
    expect(stats.snapshot().streak).toBe(0);
    await stats.onCorrectSolve();
    expect(stats.snapshot()).toMatchObject({ solved: 4, streak: 0, bestStreak: 3, today: 4 });
  });

  it('second wrong move on same puzzle does not double-reset (streak stays 0)', async () => {
    const { stats } = await freshStatsStore();
    stats.streak = 5;
    stats.bestStreak = 5;
    stats.puzzleHadError = false;

    stats.startPuzzle();
    await stats.onWrongMove();
    expect(stats.snapshot().streak).toBe(0);
    await stats.onWrongMove();
    expect(stats.snapshot().streak).toBe(0);
  });

  it('skip / show: solved unchanged, streak unchanged', async () => {
    const { stats } = await freshStatsStore();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    expect(stats.snapshot().streak).toBe(1);

    stats.startPuzzle();
    await stats.onSkipOrShow();
    expect(stats.snapshot()).toMatchObject({ solved: 1, streak: 1, today: 1 });

    stats.startPuzzle();
    await stats.onSkipOrShow();
    expect(stats.snapshot()).toMatchObject({ solved: 1, streak: 1, today: 1 });
  });

  it('persistence: values round-trip through Store', async () => {
    const store = await new Store().open();
    const s1 = await new Stats(store).load();
    s1.startPuzzle();
    await s1.onCorrectSolve();
    s1.startPuzzle();
    await s1.onCorrectSolve();
    await store.close();

    const store2 = await new Store().open();
    const s2 = await new Stats(store2).load();
    expect(s2.snapshot()).toMatchObject({ solved: 2, streak: 2, bestStreak: 2, today: 2 });
    await store2.close();
  });

  it('midnight rollover: today resets to 0 on next solve when date changes', async () => {
    const store = await new Store().open();
    await store.setMeta('todayDate', '2026-04-30');
    await store.setMeta('todayCount', 17);
    await store.close();

    const store2 = await new Store().open();
    const s2 = await new Stats(store2).load();
    expect(s2.snapshot().today).toBe(0);

    s2.startPuzzle();
    await s2.onCorrectSolve();
    expect(s2.snapshot().today).toBe(1);
    await store2.close();
  });

  it('reset() zeros all stats and clears the puzzle error flag', async () => {
    const { stats } = await freshStatsStore();
    // Build up some state.
    for (let i = 0; i < 3; i++) {
      stats.startPuzzle();
      await stats.onCorrectSolve();
    }
    stats.startPuzzle();
    await stats.onWrongMove();
    expect(stats.snapshot().solved).toBe(3);
    expect(stats.snapshot().bestStreak).toBe(3);
    expect(stats.puzzleHadError).toBe(true);

    await stats.reset();

    expect(stats.snapshot()).toMatchObject({ solved: 0, streak: 0, bestStreak: 0, today: 0 });
    expect(stats.puzzleHadError).toBe(false);
  });
});
