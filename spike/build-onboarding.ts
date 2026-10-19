/**
 * Run a plan against Halo, in order. This is the demo.
 *
 *   npm run build:onboarding              dry run: reads only, prints every payload it WOULD send
 *   npm run build:onboarding -- --apply   really creates the objects (needs the .env safety switches)
 *   npm run build:onboarding -- --plan plans/other.json
 *   npm run build:onboarding -- --fresh-templates          re-read templates from the instance
 *
 * Per step: reuse an existing object by name, create it from its template fixture, or update
 * an existing one with a partial POST; then read it back to verify. Re-running is safe: anything that already exists
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
import { ensureTemplates } from './lib/discover.js';
import { type Plan, type Refs, refsOf, translators } from './lib/translators.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const planIdx = args.indexOf('--plan');
const planFile = planIdx >= 0 ? args[planIdx + 1] : 'plans/onboarding.json';
const freshTemplates = args.includes('--fresh-templates');

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
type Outcome = 'reused' | 'already exists' | 'created' | 'would create' | 'updated' | 'would update' | 'failed';
const refs: Refs = {};
const log: { step: string; object: string; outcome: Outcome; id?: unknown; warnings: string[]; payload?: unknown; error?: string }[] = [];

const nameOf = (r: Record<string, unknown> | null | undefined, key = 'name') => String(r?.[key] ?? r?.name ?? '');

async function findByName(resource: string, name: string, key = 'name'): Promise<Record<string, unknown> | undefined> {
  const rows = extractList(await haloGet(`/${resource}`));
  const want = name.trim().toLowerCase();
  // List rows don't always carry the same name property as the full record
  // (Outcome lists have `buttonname`, full records also have `outcome`), so check all of them.
  return rows.find((r) =>
    [r[key], r.name, r.label, r.buttonname, r.outcome].some((v) => String(v ?? '').trim().toLowerCase() === want),
  );
}

// Read the instance: pick templates from THIS Halo for everything the plan creates (read-only).
console.log(`Reading the instance for templates${freshTemplates ? ' (fresh)' : ''}:`);
console.log((await ensureTemplates(plan.steps, { fresh: freshTemplates })).join('\n') || '  (nothing to create)');
console.log('');

// Pre-flight: everything the plan must FIND (reuse/update targets) has to exist before ANYTHING is written.
// Rule S7 (2026-10-19): a run wrote two objects, then failed on a lookup it could have checked up front.
const createdInPlan = new Set(plan.steps.filter((s) => s.action === 'create').map((s) => `${s.object}:${(s.name ?? '').toLowerCase()}`));
const missing: string[] = [];
for (const step of plan.steps) {
  if (step.action !== 'reuse' && step.action !== 'update') continue;
  const t = translators[step.object];
  const want = step.match?.name ?? '';
  if (createdInPlan.has(`${step.object}:${want.toLowerCase()}`)) continue;
  if (!(await findByName(t.resource, want, t.nameKey))) missing.push(`${step.id}: no ${t.resource} named "${want}"`);
}
if (missing.length) {
  console.error(`Pre-flight failed. Nothing was written.\n  ${missing.join('\n  ')}\n`);
  process.exit(1);
}
console.log('Pre-flight OK: everything the plan needs to find exists.\n');

for (const [i, step] of plan.steps.entries()) {
  const t = translators[step.object];
  const label = `${i + 1}/${plan.steps.length} ${step.object.padEnd(16)} ${step.name ?? step.match?.name ?? step.id}`;
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  try {
    if (step.action === 'reuse') {
      const found = await findByName(t.resource, step.match?.name ?? '', t.nameKey);
      if (!found) throw new Error(`No ${t.resource} named "${step.match?.name}" to reuse. Create it in Halo first.`);
      // Keep the full record so later steps can copy settings from it (e.g. a team's department, rule T3).
      const row = firstRecord(await haloGet(`/${t.resource}/${found.id}`, { includedetails: 'true' })) ?? found;
      refs[step.id] = { id: found.id as number, name: nameOf(found, t.nameKey), row };
      log.push({ step: step.id, object: step.object, outcome: 'reused', id: found.id, warnings });
      console.log(`✓ ${label}  reused id ${found.id}`);
      continue;
    }

    if (step.action === 'update') {
      // Change properties on an existing record with a partial POST (proven safe, rule U0).
      if (!t.update) throw new Error(`No update support for ${step.object}`);
      const target = await findByName(t.resource, step.match?.name ?? '', t.nameKey);
      if (!target && !apply) {
        // Dry run: the target may be created by an earlier step of this plan, so it doesn't exist yet.
        const madeEarlier = plan.steps.some((s) => s.object === step.object && s.action === 'create' && String(s.name).toLowerCase() === String(step.match?.name).toLowerCase());
        if (madeEarlier) {
          refs[step.id] = refs[step.id] ?? { id: 0, name: step.match?.name ?? '' };
          log.push({ step: step.id, object: step.object, outcome: 'would update', warnings });
          console.log(`· ${label}  would update (created earlier in this plan)`);
          continue;
        }
      }
      if (!target) throw new Error(`No ${t.resource} named "${step.match?.name}" to update.`);
      const changes = t.update(step, refs, warn);
      refs[step.id] = { id: target.id as number, name: nameOf(target, t.nameKey) };
      if (!apply) {
        log.push({ step: step.id, object: step.object, outcome: 'would update', id: target.id, warnings, payload: changes });
        console.log(`· ${label}  would update id ${target.id}: ${JSON.stringify(changes)}`);
      } else {
        await haloPost(`/${t.resource}`, [{ id: target.id, ...changes }]);
        const back = firstRecord(await haloGet(`/${t.resource}/${target.id}`, { includedetails: 'true' })) ?? {};
        const bad = Object.keys(changes).filter((k) => JSON.stringify(back[k]) !== JSON.stringify(changes[k]));
        for (const k of bad) warn(`Update not saved: ${k} is ${JSON.stringify(back[k])}, wanted ${JSON.stringify(changes[k])}`);
        log.push({ step: step.id, object: step.object, outcome: 'updated', id: target.id, warnings, payload: changes });
        console.log(`~ ${label}  updated id ${target.id}${bad.length ? '' : ', verified'}`);
      }
      for (const w of warnings) console.log(`    ! ${w}`);
      continue;
    }

    const expectedName = t.storedName?.(step) ?? step.name ?? '';
    const existing = await findByName(t.resource, expectedName, t.nameKey);
    if (existing) {
      refs[step.id] = { id: existing.id as number, name: nameOf(existing, t.nameKey) };
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
      refs[step.id] = { id: created.id as number, name: expectedName };

      // Rule F6: some objects only finish setting up on their first real save after creation.
      if (t.afterCreate) {
        await haloPost(`/${t.resource}`, [t.afterCreate(created.id as number)]);
      }

      // Read back and check the name stuck: the cheapest proof it really saved.
      const back = firstRecord(await haloGet(`/${t.resource}/${created.id}`, { includedetails: 'true' }));
      const ok = nameOf(back, t.nameKey) === expectedName;
      if (!ok) warn(`Read-back mismatch: expected name "${expectedName}", got "${nameOf(back, t.nameKey)}"`);

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
