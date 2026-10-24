/**
 * Run a plan against Halo, in order. This is the demo.
 *
 *   npm run build:onboarding              dry run: reads only, prints every payload it WOULD send
 *   npm run build:onboarding -- --apply   really creates the objects (needs the .env safety switches)
 *   npm run build:onboarding -- --plan plans/other.json
 *   npm run build:onboarding -- --plan latest      the newest plan from npm run plan
 *   npm run build:onboarding -- --plan downloads   the newest plan downloaded from the Specflow app
 *   npm run build:onboarding -- --fresh-templates          re-read templates from the instance
 *
 * Per step: reuse an existing object by name, create it from its template, or update an existing one with a
 * partial POST; then read it back to verify. Re-running is safe: anything that already exists with the same name
 * is reused, not duplicated. Stops at the first hard failure. The build itself lives in lib/build.ts, shared
 * with the Specflow app; this file is the command line around it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildWithGate } from './lib/build.js';
import { assertWritesAllowed, env, envHalo, fileTemplates, loadJson, saveJson, spikePath, timestamp } from './lib/halo.js';
import { withRuntime } from './lib/runtime.js';
import type { Plan } from './lib/translators.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
// Rule B1 (2026-10-23): an apply first dry-runs the WHOLE plan; any warning or failure means nothing is written.
// (G5 applied with two warnings showing in its dry run and stopped at step 32 of 32.) --allow-warnings overrides.
const allowWarnings = args.includes('--allow-warnings');

const planIdx = args.indexOf('--plan');
let planFile = planIdx >= 0 ? args[planIdx + 1] : 'plans/onboarding.json';
// --plan latest = the newest plan the planner saved in plans/generated/
if (planFile === 'latest') {
  const dir = spikePath('plans/generated');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) throw new Error('No generated plans yet: run npm run plan first.');
  planFile = `plans/generated/${files.at(-1)}`;
}
// --plan downloads = the newest plan downloaded from the Specflow app ("Download for the builder"), copied into
// plans/generated/ so runs can be traced back to it. Same dry-run gate (B1) as any other plan.
if (planFile === 'downloads') {
  const dir = join(homedir(), 'Downloads');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => /^(enact|specflow)-plan.*\.json$/i.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
    : [];
  if (!files.length) throw new Error(`No enact-plan*.json in ${dir}: use "Download for the builder" on a ready plan in the app first.`);
  const target = `plans/generated/app-${files[0].f.replace(/\s+/g, '-')}`;
  mkdirSync(spikePath('plans/generated'), { recursive: true });
  copyFileSync(join(dir, files[0].f), spikePath(target));
  planFile = target;
}
const freshTemplates = args.includes('--fresh-templates');

if (apply) assertWritesAllowed();

const plan = loadJson<Plan>(planFile);
console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} → ${env.apiUrl}`);
console.log(`Plan: ${planFile}\n"${plan.request}"\n`);

// Templates are cached as files per instance (fixtures/templates/<host>/), as before.
const result = await withRuntime({ halo: envHalo, templates: fileTemplates }, () =>
  buildWithGate(plan, {
    apply,
    allowWarnings,
    freshTemplates,
    emit: (e) => {
      if (e.type === 'line') console.log(e.text);
    },
  }),
);

if (result.refused) {
  console.error(`\nFix the plan, or re-run with --allow-warnings if you've checked each one.\n`);
  process.exit(1);
}
if (!result.log.length && result.problems.length) {
  for (const p of result.problems) console.error(p);
  process.exit(1);
}

const file = saveJson(`runs/build-${apply ? 'apply' : 'dry'}-${timestamp()}.json`, { plan: planFile, apply, refs: result.refs, log: result.log });
const gaps = result.log.reduce((n, l) => n + l.warnings.length, 0);
console.log(`\nRun log: ${file}`);
console.log(gaps ? `${gaps} warning(s): fill the gaps in spike/lib/translators.ts → SPIKE_MAP.\n` : 'No gaps.\n');
