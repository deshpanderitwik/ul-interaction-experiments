#!/usr/bin/env node
// Build the static web site into dist/ for GitHub Pages.
//
//   WEB_BASE_URL=/ul-interaction-experiments node scripts/export-web.mjs
//
// 1. `expo export --platform web` (static output: one HTML per route).
// 2. Copy CanvasKit's wasm next to the site (Skia loads it via locateFile).
// 3. Reshape `x.html` → `x/index.html` so trailing-slash URLs resolve on
//    GitHub Pages (and through the ritwik.design proxy, which keeps slashes).
// 4. `+not-found.html` → `404.html`, plus `.nojekyll`.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const base = process.env.WEB_BASE_URL ?? '';

console.log(`› expo export --platform web (base "${base || '/'}")`);
execSync('npx expo export --platform web --clear', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WEB_BASE_URL: base },
});

// public/ is copied into dist by expo export, but keep dist self-contained
// even if public/ was never populated (fresh clone, export before dev).
const wasm = join(root, 'node_modules/canvaskit-wasm/bin/full/canvaskit.wasm');
cpSync(wasm, join(dist, 'canvaskit.wasm'));
console.log('› copied canvaskit.wasm');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let moved = 0;
for (const file of walk(dist)) {
  if (!file.endsWith('.html')) continue;
  const rel = relative(dist, file);
  if (rel === 'index.html') continue;
  if (rel === '+not-found.html' || rel === '404.html') {
    renameSync(file, join(dist, '404.html'));
    continue;
  }
  if (rel.endsWith('/index.html')) continue;
  const dir = file.slice(0, -'.html'.length);
  mkdirSync(dir, { recursive: true });
  renameSync(file, join(dir, 'index.html'));
  moved++;
}
console.log(`› reshaped ${moved} route(s) into directory indexes`);

writeFileSync(join(dist, '.nojekyll'), '');
if (!existsSync(join(dist, '404.html'))) cpSync(join(dist, 'index.html'), join(dist, '404.html'));
console.log('› done → dist/');
