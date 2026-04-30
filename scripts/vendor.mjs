// Copies the ESM build of each vendored library out of node_modules
// into /vendor/ so the deployed site has zero install / network deps.
// Idempotent. Re-run after `npm install` or `npm update`.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const vendorRoot = join(repoRoot, 'vendor');

async function readPackageEntry(pkgName) {
  const pkgJson = JSON.parse(
    await readFile(join(repoRoot, 'node_modules', pkgName, 'package.json'), 'utf8'),
  );
  // Prefer ESM via "exports" → "import" → "default", then "module", then "main".
  let entry = null;
  const exp = pkgJson.exports;
  if (typeof exp === 'string') {
    entry = exp;
  } else if (exp && typeof exp === 'object') {
    const root = exp['.'] ?? exp;
    if (typeof root === 'string') {
      entry = root;
    } else if (root && typeof root === 'object') {
      const candidate = root.import ?? root.default ?? root.module;
      if (typeof candidate === 'string') entry = candidate;
    }
  }
  if (entry == null) entry = pkgJson.module ?? pkgJson.main ?? null;
  if (typeof entry !== 'string' || entry.length === 0) {
    throw new Error(`Could not resolve ESM entry for ${pkgName}; inspect its package.json`);
  }
  return entry.replace(/^\.\//, '');
}

async function vendorPackage(pkgName) {
  const src = join(repoRoot, 'node_modules', pkgName);
  const dst = join(vendorRoot, pkgName);
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  // Copy the entire package directory; we'll let GitHub Pages serve only what's referenced.
  // This is simpler than cherry-picking files and avoids missing assets.
  await cp(src, dst, {
    recursive: true,
    filter: (file) => !file.endsWith('node_modules'),
  });
  const entry = await readPackageEntry(pkgName);
  console.log(`  ${pkgName}: entry = ${entry}`);
  return entry;
}

console.log('Vendoring libraries into /vendor/ ...');
const chessEntry = await vendorPackage('chess.js');
const boardEntry = await vendorPackage('cm-chessboard');

const importMapHint = {
  'chess.js': `/vendor/chess.js/${chessEntry}`,
  'cm-chessboard': `/vendor/cm-chessboard/${boardEntry}`,
};
console.log('\nImport map paths to use in index.html:');
console.log(JSON.stringify({ imports: importMapHint }, null, 2));

// Also write the hint to a file so subsequent tasks can paste it in.
await writeFile(
  join(vendorRoot, '.import-map-hint.json'),
  JSON.stringify({ imports: importMapHint }, null, 2),
);
console.log('\nDone. (Hint written to vendor/.import-map-hint.json)');
