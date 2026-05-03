import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('manifest.json', () => {
  it('parses as JSON', () => {
    const text = readFileSync(resolve(REPO_ROOT, 'manifest.json'), 'utf8');
    const m = JSON.parse(text);
    expect(m).toBeTruthy();
  });

  it('has all required PWA fields', () => {
    const m = JSON.parse(readFileSync(resolve(REPO_ROOT, 'manifest.json'), 'utf8'));
    expect(m.name).toBe('Chess Puzzles');
    expect(m.short_name).toBe('Chess Puzzles');
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#7a4a2b');
    expect(m.background_color).toBe('#1a1614');
    expect(Array.isArray(m.icons)).toBe(true);
  });

  it('has three icons including a maskable one', () => {
    const m = JSON.parse(readFileSync(resolve(REPO_ROOT, 'manifest.json'), 'utf8'));
    expect(m.icons).toHaveLength(3);
    const sizes = m.icons.map((i) => i.sizes).sort();
    expect(sizes).toEqual(['192x192', '512x512', '512x512']);
    const maskable = m.icons.filter((i) => i.purpose === 'maskable');
    expect(maskable).toHaveLength(1);
    expect(maskable[0].sizes).toBe('512x512');
  });
});
