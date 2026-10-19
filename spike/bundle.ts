/**
 * Bundle every detail fixture (e.g. tickettype-36.json, fieldinfo-141.json) into ONE file,
 * so it can be shared in a single upload.
 *
 *   npm run bundle            → SEND-TO-CLAUDE.txt in the project folder (and opens the folder on Windows)
 *
 * List fixtures (tickettype.json, fieldinfo.json, ...) are skipped: too big, not needed.
 * Template fixtures (template-*.json) are included.
 */
import { exec } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPIKE_DIR, loadJson, spikePath } from './lib/halo.js';

const files = readdirSync(spikePath('fixtures'))
  .filter((f) => f.endsWith('.json') && (/-\-?\d+\.json$/.test(f) || f.startsWith('template-')))
  .sort();

const bundle: Record<string, unknown> = {};
for (const f of files) bundle[f] = loadJson(`fixtures/${f}`);

// One obviously named .txt in the project root: easy to find, and chat accepts .txt.
const projectDir = resolve(SPIKE_DIR, '..');
const out = resolve(projectDir, 'SEND-TO-CLAUDE.txt');
writeFileSync(out, JSON.stringify(bundle, null, 2));
console.log(`\nBundled ${files.length} fixture(s):`);
for (const f of files) console.log(`  ${f}`);
console.log(`\n→ ${out}\nAttach SEND-TO-CLAUDE.txt in the chat.\n`);
if (process.platform === 'win32') exec(`explorer /select,"${out}"`);
