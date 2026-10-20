// Refreshes the embedded snapshot (index.html + data/factchecks.json) from all fact-check sources.
// Usage: node scripts/update-data.mjs   (Node 18+)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadAll } from '../lib/sources.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Previous snapshot, so Globes checks that drop out of the 15-item RSS window are kept.
let prev = {};
try { prev = JSON.parse(await readFile(path.join(root, 'data', 'factchecks.json'), 'utf8')); } catch {}

const snapshot = await loadAll(prev, console.log);
await writeFile(path.join(root, 'data', 'factchecks.json'), JSON.stringify(snapshot, null, 2));

const htmlPath = path.join(root, 'index.html');
const html = await readFile(htmlPath, 'utf8');
const json = JSON.stringify(snapshot).replace(/</g, '\\u003c');
await writeFile(htmlPath, html.replace(/(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/, () => `<script type="application/json" id="snapshot">${json}</script>`));
console.log(`Saved ${snapshot.n12.length + snapshot.fakereporter.length + snapshot.globes.length + snapshot.rulings.length} items (${snapshot.fetchedAt})`);
