/**
 * Change specific properties on an EXISTING record: POST [{ id, ...changes }].
 *
 *   npm run update -- FieldInfo 316 visibility=1
 *   npm run update -- FieldInfo 316 visibility=1 inputtype=0
 *
 * Values are parsed as numbers / true / false where they look like one, otherwise strings.
 * Reads the record back afterwards and shows before → after for each property changed.
 */
import { firstRecord, haloGet, haloPost, saveJson, timestamp } from './lib/halo.js';

const args = process.argv.slice(2);
const [resource, id] = args.filter((a) => !a.includes('='));
const changes: Record<string, unknown> = {};
for (const a of args.filter((x) => x.includes('='))) {
  const [k, raw] = a.split('=', 2) as [string, string];
  changes[k] = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
}

if (!resource || !id || !Object.keys(changes).length) {
  console.error('Usage: npm run update -- <Resource> <id> key=value [key=value ...]');
  process.exit(1);
}

const before = firstRecord(await haloGet(`/${resource}/${id}`, { includedetails: 'true' })) ?? {};
console.log(`\nPOST /${resource} update id ${id}: ${JSON.stringify(changes)}`);
const response = await haloPost(`/${resource}`, [{ id: Number(id), ...changes }]);
const after = firstRecord(await haloGet(`/${resource}/${id}`, { includedetails: 'true' })) ?? {};

for (const k of Object.keys(changes)) {
  const stuck = JSON.stringify(after[k]) === JSON.stringify(changes[k]);
  console.log(`  ${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}  ${stuck ? '✅ saved' : '❌ NOT saved'}`);
}

// Partial updates must not wipe other properties: count what else changed.
const others = Object.keys({ ...before, ...after }).filter(
  (k) => !(k in changes) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
);
console.log(others.length ? `  ⚠️ other properties changed too: ${others.join(', ')}` : '  No other properties changed.');

const file = saveJson(`runs/update-${resource.toLowerCase()}-${id}-${timestamp()}.json`, { changes, before, after, response });
console.log(`Saved ${file}\n`);
