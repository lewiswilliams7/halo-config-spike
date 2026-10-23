/**
 * Find out why Halo rejects a create: re-send ONE step's payload from a dry-run log, with some
 * properties changed. Writes through haloPost (so the .env safety switches apply). Never deletes.
 *
 *   npm run try-post -- latest tt_emergency risk_calculation= risk_type=0
 *
 * "latest" = the newest dry-run log in spike/runs. key=value overrides top-level properties
 * (empty value = empty string; numbers and true/false are converted). If it succeeds, the new
 * record is real: it's the object the plan wanted, so name it accordingly.
 */
import { readdirSync } from 'node:fs';
import { firstRecord, haloPost, loadJson, spikePath } from './lib/halo.js';
import { translators } from './lib/translators.js';

const [logArg, stepId, ...pairs] = process.argv.slice(2);
if (!logArg || !stepId) {
  console.error('Usage: npm run try-post -- latest STEP_ID key=value ...');
  process.exit(1);
}
const logFile =
  logArg === 'latest'
    ? `runs/${readdirSync(spikePath('runs')).filter((f) => f.startsWith('build-dry-') && f.endsWith('.json')).sort().at(-1)}`
    : logArg;
const log = loadJson<{ log: { step: string; object: string; payload?: Record<string, unknown> }[] }>(logFile);
const entry = log.log.find((e) => e.step === stepId);
if (!entry?.payload) throw new Error(`No payload for step "${stepId}" in ${logFile}`);

const payload: Record<string, unknown> = { ...entry.payload };
for (const pair of pairs) {
  const i = pair.indexOf('=');
  const k = pair.slice(0, i);
  const raw = pair.slice(i + 1);
  payload[k] = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  console.log(`  override ${k} = ${JSON.stringify(payload[k])}`);
}

const resource = translators[entry.object as keyof typeof translators].resource;
console.log(`\nPOST /${resource}  (step ${stepId} from ${logFile})`);
try {
  const created = firstRecord(await haloPost(`/${resource}`, [payload]));
  console.log(`\nAccepted: created id ${created?.id} "${created?.name ?? ''}". The override fixed it.\n`);
} catch (e) {
  console.log(`\nStill rejected:\n${String((e as Error).message)}\n`);
}
