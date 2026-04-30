// Copies the ESM build of each vendored library out of node_modules
// into /vendor/ so the deployed site has zero install / network deps.
// Idempotent. Re-run after `npm install` or `npm update`.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const vendorRoot = join(repoRoot, 'vendor');

async function readPackageEntry(pkgName) {
  const pkgJson = JSON.parse(
    await readFile(join(repoRoot, 'node_modules', pkgName, 'package.json'), 'utf8'),
  );
  // Prefer ESM via "exports" → "import", then "module", then "main"
  const exp = pkgJson.exports;
  if (typeof exp === 'string') return exp;
  if (exp && typeof exp === 'object') {
    const root = exp['.'] ?? exp;
    if (typeof root === 'string') return root;
    if (root && typeof root === 'object') {
      return root.import ?? root.default ?? root.module ?? null;
    }
  }
  return pkgJson.module ?? pkgJson.main ?? null;
}

async function vendorPackage(pkgName) {
  const src = join(repoRoot, 'node_modules', pkgName);
  const dst = join(vendorRoot, pkgName);
  if (existsSync(dst)) await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  // Copy the entire package directory; we'll let GitHub Pages serve only what's referenced.
  // This is simpler than cherry-picking files and avoids missing assets.
  await cp(src, dst, {
    recursive: true,
    filter: (file) => !file.endsWith('node_modules'),
  });
  const entry = await readPackageEntry(pkgName);
  console.log(`  ${pkgName}: entry = ${entry ?? '(unknown — check manually)'}`);
  return entry;
}

console.log('Vendoring libraries into /vendor/ ...');
const chessEntry = await vendorPackage('chess.js');
const boardEntry = await vendorPackage('cm-chessboard');

const importMapHint = {
  'chess.js': `/vendor/chess.js/${chessEntry ?? '<entry>'}`,
  'cm-chessboard': `/vendor/cm-chessboard/${boardEntry ?? '<entry>'}`,
};
console.log('\nImport map paths to use in index.html:');
console.log(JSON.stringify({ imports: importMapHint }, null, 2));

// Also write the hint to a file so subsequent tasks can paste it in.
await writeFile(
  join(vendorRoot, '.import-map-hint.json'),
  JSON.stringify({ imports: importMapHint }, null, 2),
);
console.log('\nDone. (Hint written to vendor/.import-map-hint.json)');
