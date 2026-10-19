/**
 * Bundle every detail fixture (e.g. tickettype-36.json, fieldinfo-141.json) into ONE file,
 * so it can be shared in a single upload.
 *
 *   npm run bundle            → spike/runs/bundle.json
 *
 * List fixtures (tickettype.json, fieldinfo.json, ...) are skipped: too big, not needed.
 * Template fixtures (template-*.json) are included.
 */
import { readdirSync } from 'node:fs';
import { loadJson, saveJson, spikePath } from './lib/halo.js';

const files = readdirSync(spikePath('fixtures'))
  .filter((f) => f.endsWith('.json') && (/-\-?\d+\.json$/.test(f) || f.startsWith('template-')))
  .sort();

const bundle: Record<string, unknown> = {};
for (const f of files) bundle[f] = loadJson(`fixtures/${f}`);

const out = saveJson('runs/bundle.json', bundle);
console.log(`\nBundled ${files.length} fixture(s):`);
for (const f of files) console.log(`  ${f}`);
console.log(`\n→ ${out}\nAttach that one file in the chat.\n`);
