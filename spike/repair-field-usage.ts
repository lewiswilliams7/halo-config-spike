/**
 * Rule F10 repair: find custom fields on ticket forms or sections that aren't ticket fields (usage ≠ 1) and,
 * with --apply, set them to usage 1, then read each one back to confirm. Never deletes anything.
 *
 *   npm run repair:usage             lists what it would fix (read-only)
 *   npm run repair:usage -- --apply  fixes them (needs the .env write switches)
 */
import { assertWritesAllowed, env, extractList, firstRecord, haloGet, haloPost } from './lib/halo.js';

type Row = Record<string, unknown>;
const apply = process.argv.includes('--apply');
if (apply) assertWritesAllowed();
console.log(`\n${apply ? 'REPAIRING' : 'CHECKING (nothing will be written)'} → ${env.apiUrl}\n`);

const found = new Map<number, { name: string; label: string; usage: unknown; on: Set<string> }>();
function note(fi: Row | undefined, where: string) {
  if (!fi) return;
  const name = String(fi.name ?? '');
  if (!name.startsWith('CF') || Number(fi.custom) !== 1 || Number(fi.usage) === 1) return;
  const id = Number(fi.id);
  const hit = found.get(id) ?? { name, label: String(fi.label ?? ''), usage: fi.usage, on: new Set<string>() };
  hit.on.add(where);
  found.set(id, hit);
}

for (const g of extractList(await haloGet('/FieldGroup'))) {
  const d = firstRecord(await haloGet(`/FieldGroup/${g.id}`, { includedetails: 'true' })) ?? {};
  for (const r of (d.fields as Row[]) ?? []) note(r.fieldinfo as Row, `section "${d.name}"`);
}
for (const t of extractList(await haloGet('/TicketType'))) {
  const d = firstRecord(await haloGet(`/TicketType/${t.id}`, { includedetails: 'true' })) ?? {};
  for (const r of (d.fields as Row[]) ?? []) note(r.fieldinfo as Row, `form "${d.name}"`);
}

// Confirm from each field's own record: the copies nested in forms can be out of date.
for (const id of [...found.keys()]) {
  const d = firstRecord(await haloGet(`/FieldInfo/${id}`, { includedetails: 'true' })) ?? {};
  if (Number(d.usage) === 1) found.delete(id);
}

if (!found.size) {
  console.log('Every custom field on a form or section is a ticket field. Nothing to fix.\n');
  process.exit(0);
}
for (const [id, f] of found) console.log(`  ${f.name} ("${f.label}", id ${id}) usage ${f.usage}, on ${[...f.on].join(', ')}`);
if (!apply) {
  console.log(`\n${found.size} field(s) to fix. Run again with --apply to set them to ticket fields.\n`);
  process.exit(0);
}

let fixed = 0;
for (const [id, f] of found) {
  try {
    await haloPost('/FieldInfo', [{ id, usage: 1 }]);
    const back = firstRecord(await haloGet(`/FieldInfo/${id}`, { includedetails: 'true' })) ?? {};
    if (Number(back.usage) === 1) {
      fixed++;
      console.log(`~ ${f.name}  now a ticket field, verified`);
    } else console.log(`✗ ${f.name}  Halo kept usage ${back.usage}: it won't change this setting on an existing field`);
  } catch (e) {
    console.log(`✗ ${f.name}  ${String((e as Error).message).split('\n')[0]}`);
  }
}
console.log(`\n${fixed} of ${found.size} fixed.${fixed < found.size ? ' Send this output to Claude: the rest need a replacement field instead.' : ' Log out and back in, then try the forms again.'}\n`);
