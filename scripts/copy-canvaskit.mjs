#!/usr/bin/env node
// Put CanvasKit's wasm where the web build can fetch it: public/ is served
// at the site root by both the dev server and `expo export`. The file is
// 8 MB and lives in node_modules, so it's copied on demand (and gitignored)
// rather than committed.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/canvaskit-wasm/bin/full/canvaskit.wasm');
const dst = join(root, 'public/canvaskit.wasm');
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst);
console.log('› canvaskit.wasm → public/');
