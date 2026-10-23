/**
 * Find out why Halo rejects a create: re-send ONE step's payload from a dry-run log, with some
 * properties changed. Writes through haloPost (so the .env safety switches apply). Never deletes.
 *
 *   npm run try-post -- latest tt_emergency risk_calculation= risk_type=0
 *   npm run try-post -- latest tt_emergency --bisect      (tries each suspect in turn)
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
for (const pair of pairs.filter((x) => x !== '--bisect')) {
  const i = pair.indexOf('=');
  const k = pair.slice(0, i);
  const raw = pair.slice(i + 1);
  payload[k] = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  console.log(`  override ${k} = ${JSON.stringify(payload[k])}`);
}

const resource = translators[entry.object as keyof typeof translators].resource;

// --bisect: try one suspect at a time, stop at the first Halo accepts (that record is then real).
const variants: [string, Record<string, unknown>][] = pairs.includes('--bisect')
  ? [
      ['no approval process', { approval_process_id: 0, approval_process_name: '' }],
      ['no SLA', { default_sla: -1 }],
      ['ITIL type Service Request instead of Change', { itilrequesttype: 3 }],
      ['no portal user fields', { userfields: [] }],
      ['no apply-on-type-change settings', { apply_workflow_on_type_change: false, applydefaultsontypechangebool: false }],
      ['different name', { name: `${payload.name} Request` }],
      ['no approval, no SLA, no risk', { approval_process_id: 0, approval_process_name: '', default_sla: -1, risk_type: 0, risk_calculation: '' }],
    ]
  : [['as given', {}]];

for (const [label, change] of variants) {
  console.log(`\nTry: ${label}  POST /${resource}`);
  try {
    const created = firstRecord(await haloPost(`/${resource}`, [{ ...payload, ...change }]));
    console.log(`Accepted: created id ${created?.id} "${created?.name ?? ''}". Cause: ${label}.\n`);
    process.exit(0);
  } catch (e) {
    console.log(`Rejected: ${String((e as Error).message).split('\n')[0]}`);
  }
}
console.log('\nEvery variant was rejected: the cause is elsewhere. Send this output and the newest run log.\n');
