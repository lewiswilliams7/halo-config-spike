/**
 * Find the ONE setting that makes Halo reject a ticket type create (500 with no message).
 * Read-mostly: every write goes through haloPost (.env switches apply). Never deletes.
 *
 *   npm run bisect-tt -- tt_emergency
 *
 * 1. Baselines: a plain copy of the source type (name changed only), and a plain copy of
 *    Service Request. Shows whether the source can be copied at all.
 * 2. Binary search: start from a payload Halo accepts (the plain copy that worked) and add half
 *    of the failing payload's differing settings at a time, until one setting is left.
 * Accepted test copies are real records: created hidden (visible false) and named "zz Specflow test N".
 */
import { readdirSync } from 'node:fs';
import { cleanForCreate } from './lib/clean.js';
import { extractList, firstRecord, haloGet, haloPost, loadJson, spikePath } from './lib/halo.js';

type Row = Record<string, unknown>;
const stepId = process.argv[2];
if (!stepId) {
  console.error('Usage: npm run bisect-tt -- tt_emergency');
  process.exit(1);
}
const logFile = `runs/${readdirSync(spikePath('runs')).filter((f) => f.startsWith('build-dry-') && f.endsWith('.json')).sort().at(-1)}`;
type PlanLite = { steps: { id: string; based_on?: string }[] };
const log = loadJson<{ log: { step: string; payload?: Row }[]; plan: string | PlanLite }>(logFile);
// Run logs store the plan's file name; load it to find what the step was copied from.
const plan: PlanLite = typeof log.plan === 'string' ? loadJson<PlanLite>(log.plan) : log.plan;
const bad = log.log.find((e) => e.step === stepId)?.payload;
if (!bad) throw new Error(`No payload for "${stepId}" in ${logFile}: run the dry run first.`);
const sourceName = plan.steps.find((s) => s.id === stepId)?.based_on ?? 'Change Request';

let n = 0;
async function attempt(label: string, payload: Row): Promise<boolean> {
  n++;
  const body = { ...payload, name: `zz Specflow test ${n}`, visible: false };
  try {
    const created = firstRecord(await haloPost('/TicketType', [body]));
    console.log(`  ✓ accepted  ${label}  (hidden test type id ${created?.id})`);
    return true;
  } catch (e) {
    console.log(`  ✗ rejected  ${label}  ${String((e as Error).message).split('\n')[0]}`);
    return false;
  }
}
async function plainCopy(name: string): Promise<Row | null> {
  const row = extractList(await haloGet('/TicketType')).find((t) => String(t.name).toLowerCase() === name.toLowerCase());
  if (!row) return null;
  return cleanForCreate(firstRecord(await haloGet(`/TicketType/${row.id}`, { includedetails: 'true' })) ?? {});
}

console.log(`\nFailing payload: step ${stepId} from ${logFile}\n\n1. Baselines`);
const plainSource = await plainCopy(sourceName);
const plainSR = await plainCopy('Service Request');
const sourceOk = plainSource ? await attempt(`plain copy of "${sourceName}"`, plainSource) : false;
const srOk = plainSR ? await attempt('plain copy of "Service Request"', plainSR) : false;

if (!sourceOk && !srOk) {
  console.log('\nEven plain copies are rejected: something instance-wide is wrong, not our payload. Send this output.\n');
  process.exit(0);
}
if (!sourceOk) console.log(`\nA plain copy of "${sourceName}" is rejected but Service Request isn't: "${sourceName}" can't be copied as-is through the API.`);

// 2. Binary search over the settings that differ between a good payload and the failing one.
const good = (sourceOk ? plainSource : plainSR)!;
const differs = Object.keys({ ...good, ...bad }).filter((k) => k !== 'name' && JSON.stringify(good[k]) !== JSON.stringify(bad[k]));
console.log(`\n2. Searching ${differs.length} differing settings: ${differs.join(', ')}`);

const withKeys = (keys: string[]) => {
  const p: Row = { ...good };
  for (const k of keys) {
    if (k in bad) p[k] = bad[k];
    else delete p[k];
  }
  return p;
};
let suspects = differs;
while (suspects.length > 1) {
  const half = suspects.slice(0, Math.ceil(suspects.length / 2));
  const rest = suspects.slice(half.length);
  if (!(await attempt(`good + [${half.join(', ')}]`, withKeys(half)))) suspects = half;
  else if (!(await attempt(`good + [${rest.join(', ')}]`, withKeys(rest)))) suspects = rest;
  else {
    console.log(`\nEach half alone is accepted: it's a combination of settings, not one. Suspects: ${suspects.join(', ')}\n`);
    process.exit(0);
  }
}
if (suspects.length === 1) {
  const k = suspects[0];
  console.log(`\nCause: "${k}"\n  in the failing payload: ${JSON.stringify(bad[k])?.slice(0, 400)}\n  in the accepted one:    ${JSON.stringify(good[k])?.slice(0, 400)}\n`);
} else {
  console.log('\nNo differing settings: the failing payload equals an accepted one. Send this output.\n');
}
