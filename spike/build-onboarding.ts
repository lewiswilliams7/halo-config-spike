/**
 * Run a plan against Halo, in order. This is the demo.
 *
 *   npm run build:onboarding              dry run: reads only, prints every payload it WOULD send
 *   npm run build:onboarding -- --apply   really creates the objects (needs the .env safety switches)
 *   npm run build:onboarding -- --plan plans/other.json
 *
 * Per step: reuse an existing object by name, or create it from its template fixture,
 * then read it back to verify. Re-running is safe: anything that already exists
 * with the same name is reused, not duplicated. Stops at the first hard failure.
 */
import {
  assertWritesAllowed,
  env,
  extractList,
  firstRecord,
  haloGet,
  haloPost,
  loadJson,
  saveJson,
  timestamp,
} from './lib/halo.js';
import { type Plan, type Refs, refsOf, translators } from './lib/translators.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const planIdx = args.indexOf('--plan');
const planFile = planIdx >= 0 ? args[planIdx + 1] : 'plans/onboarding.json';

if (apply) assertWritesAllowed();

const plan = loadJson<Plan>(planFile);
console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} → ${env.apiUrl}`);
console.log(`Plan: ${planFile}\n"${plan.request}"\n`);

// 1. Check order: every reference must point at an earlier step.
const seen = new Set<string>();
for (const step of plan.steps) {
  for (const ref of refsOf(step)) {
    if (!seen.has(ref)) {
      console.error(`Plan error: step "${step.id}" uses "${ref}" before it is defined.`);
      process.exit(1);
    }
  }
  seen.add(step.id);
}

// 2. Run.
type Outcome = 'reused' | 'already exists' | 'created' | 'would create' | 'failed';
const refs: Refs = {};
const log: { step: string; object: string; outcome: Outcome; id?: unknown; warnings: string[]; payload?: unknown; error?: string }[] = [];

async function findByName(resource: string, name: string): Promise<Record<string, unknown> | undefined> {
  const rows = extractList(await haloGet(`/${resource}`));
  const want = name.trim().toLowerCase();
  return rows.find((r) => String(r.name ?? '').trim().toLowerCase() === want || String(r.label ?? '').trim().toLowerCase() === want);
}

for (const [i, step] of plan.steps.entries()) {
  const t = translators[step.object];
  const label = `${i + 1}/${plan.steps.length} ${step.object.padEnd(16)} ${step.name ?? step.match?.name ?? step.id}`;
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  try {
    if (step.action === 'reuse') {
      const found = await findByName(t.resource, step.match?.name ?? '');
      if (!found) throw new Error(`No ${t.resource} named "${step.match?.name}" to reuse. Create it in Halo first.`);
      refs[step.id] = { id: found.id as number, name: String(found.name ?? '') };
      log.push({ step: step.id, object: step.object, outcome: 'reused', id: found.id, warnings });
      console.log(`✓ ${label}  reused id ${found.id}`);
      continue;
    }

    const existing = await findByName(t.resource, step.name ?? '');
    if (existing) {
      refs[step.id] = { id: existing.id as number, name: String(existing.name ?? '') };
      log.push({ step: step.id, object: step.object, outcome: 'already exists', id: existing.id, warnings });
      console.log(`= ${label}  already exists (id ${existing.id}), reused`);
      continue;
    }

    const payload = t.build(step, refs, warn);

    if (!apply) {
      refs[step.id] = { id: `<new ${step.id}>`, name: step.name };
      log.push({ step: step.id, object: step.object, outcome: 'would create', warnings, payload });
      console.log(`· ${label}  would create`);
    } else {
      const created = firstRecord(await haloPost(`/${t.resource}`, [payload]));
      if (!created?.id) throw new Error(`Halo returned no id for ${t.resource}`);
      refs[step.id] = { id: created.id as number, name: step.name };

      // Read back and check the name stuck: the cheapest proof it really saved.
      const back = firstRecord(await haloGet(`/${t.resource}/${created.id}`, { includedetails: 'true' }));
      const ok = String(back?.name ?? '') === String(step.name);
      if (!ok) warn(`Read-back mismatch: expected name "${step.name}", got "${back?.name}"`);

      log.push({ step: step.id, object: step.object, outcome: 'created', id: created.id, warnings, payload });
      console.log(`+ ${label}  created id ${created.id}${ok ? ', verified' : ''}`);
    }
    for (const w of warnings) console.log(`    ! ${w}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push({ step: step.id, object: step.object, outcome: 'failed', warnings, error: message });
    console.log(`✗ ${label}  FAILED\n    ${message.split('\n').join('\n    ')}`);
    console.log('\nStopped at first failure. Nothing after this step was attempted.');
    break;
  }
}

const file = saveJson(`runs/build-${apply ? 'apply' : 'dry'}-${timestamp()}.json`, { plan: planFile, apply, refs, log });
const gaps = log.reduce((n, l) => n + l.warnings.length, 0);
console.log(`\nRun log: ${file}`);
console.log(gaps ? `${gaps} warning(s): fill the gaps in spike/lib/translators.ts → SPIKE_MAP.\n` : 'No gaps.\n');
