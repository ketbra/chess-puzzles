// scripts/generate-icons.mjs
//
// Rasterizes icons/icon.svg → icon-192.png + icon-512.png
// Rasterizes icons/icon-maskable.svg → icon-maskable-512.png
//
// Prefers rsvg-convert; falls back to ImageMagick (magick) if absent.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ICONS_DIR = join(REPO_ROOT, 'icons');

async function commandExists(cmd) {
  return new Promise((resolve) => {
    const child = spawn('which', [cmd], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function rasterize(svgPath, outPath, size, tool) {
  let args;
  if (tool === 'rsvg-convert') {
    args = ['-w', String(size), '-h', String(size), svgPath, '-o', outPath];
  } else {
    // magick convert: input must come before options
    args = ['convert', svgPath, '-background', 'none', '-resize', `${size}x${size}`, outPath];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${tool} exited with ${code}`));
      else resolve();
    });
  });
}

async function main() {
  let tool = 'rsvg-convert';
  if (!await commandExists(tool)) {
    tool = 'magick';
    if (!await commandExists(tool)) {
      throw new Error('Neither rsvg-convert nor magick is installed. Install with: dnf install -y librsvg2-tools');
    }
    console.log('[icons] rsvg-convert not found; falling back to magick');
  }

  const src = join(ICONS_DIR, 'icon.svg');
  const srcMaskable = join(ICONS_DIR, 'icon-maskable.svg');
  if (!existsSync(src)) throw new Error(`Missing source: ${src}`);
  if (!existsSync(srcMaskable)) throw new Error(`Missing source: ${srcMaskable}`);

  console.log(`[icons] using ${tool}`);
  await rasterize(src,         join(ICONS_DIR, 'icon-192.png'),          192, tool);
  await rasterize(src,         join(ICONS_DIR, 'icon-512.png'),          512, tool);
  await rasterize(srcMaskable, join(ICONS_DIR, 'icon-maskable-512.png'), 512, tool);
  console.log('[icons] done');
}

main().catch((err) => {
  console.error('[icons]', err.message);
  process.exit(1);
});
