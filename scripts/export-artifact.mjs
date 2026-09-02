#!/usr/bin/env node
// Flatten the web build into ONE html file for hosts that serve a single
// page and no sibling files (preview viewers, pastebins):
//
//   node scripts/export-artifact.mjs [out.html]
//
// - single-page output, no bundle splitting → one JS bundle
// - the JS bundle is inlined
// - canvaskit.wasm is inlined as base64; WebShell answers the loader's fetch
//   from memory (see installInlineWasm)
// - emits the <head> children + <body> children only (no html/head/body
//   wrappers) so a host can drop it into its own document skeleton.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = process.argv[2] ?? join(root, 'dist', 'artifact.html');

if (!process.env.SKIP_EXPORT) {
  execSync('npx expo export --platform web --clear', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WEB_BASE_URL: '', WEB_OUTPUT: 'single', EXPO_NO_BUNDLE_SPLITTING: '1' },
  });
}

let html = readFileSync(join(dist, 'index.html'), 'utf8');

// Inline every bundled script.
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/g)];
if (scripts.length === 0) throw new Error('no script tags found in index.html');
for (const m of scripts) {
  const src = m[1].replace(/^\//, '');
  const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  html = html.replace(m[0], () => `<script>${js}</script>`);
}

// Inline the wasm.
const wasm = readFileSync(join(root, 'node_modules/canvaskit-wasm/bin/full/canvaskit.wasm'));
const b64 = wasm.toString('base64');
html = html.replace('<head>', () => `<head><script>window.__SINGLE_FILE=true;window.__CANVASKIT_WASM_B64=${JSON.stringify(b64)};</script>`);

// Strip the document skeleton; keep the head and body contents.
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? '';
const title = '<title>Interaction Experiments</title>\n';
const fragment = title + head.replace(/<title[^>]*>[\s\S]*?<\/title>/g, '') + '\n' + body;
writeFileSync(out, fragment);
console.log(`› wrote ${out} (${(fragment.length / 1048576).toFixed(1)} MB)`);
