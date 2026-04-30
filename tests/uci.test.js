import { describe, it, expect } from 'vitest';
import { parseUci } from '../src/uci.js';

describe('parseUci', () => {
  it('parses a standard 4-char UCI', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4' });
  });

  it('parses a promotion UCI', () => {
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('parses a knight underpromotion', () => {
    expect(parseUci('a7a8n')).toEqual({ from: 'a7', to: 'a8', promotion: 'n' });
  });

  it('throws on malformed input', () => {
    expect(() => parseUci('e2')).toThrow();
    expect(() => parseUci('')).toThrow();
    expect(() => parseUci('e9e4')).toThrow();
  });
});
