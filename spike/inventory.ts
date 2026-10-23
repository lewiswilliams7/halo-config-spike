/**
 * Write what exists on the connected instance to SEND-TO-CLAUDE.txt (and print a summary).
 *   npm run inventory
 */
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INSTANCE_KEY, SPIKE_DIR } from './lib/halo.js';
import { readInventory } from './lib/inventory.js';

console.log(`\nReading ${INSTANCE_KEY} (read-only) …`);
const inv = await readInventory({ progress: (m) => console.log(`  reading ${m} …`) });
for (const [k, v] of Object.entries(inv)) if (k !== 'details' && v) console.log(`  ${k.padEnd(28)} ${Array.isArray(v) ? v.length : Object.keys(v).length}`);
const out = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(out, JSON.stringify({ instance: INSTANCE_KEY, inventory: inv }, null, 2));
console.log(`\n→ ${out}\nAttach SEND-TO-CLAUDE.txt in the chat.\n`);
if (process.platform === 'win32') exec(`explorer /select,"${out}"`);
