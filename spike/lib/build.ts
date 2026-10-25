/**
 * The builder: runs a plan against the Halo in the current runtime (lib/runtime.ts). Plain code, no AI.
 * Used by the spike CLI (build-onboarding.ts) and the Specflow app. Every Halo rule in HALO_RULES.md that the
 * build relies on lives here or in translators.ts.
 * Shared file: keep identical to the app's lib/specflow/build/build.ts (only import lines differ).
 */
import { ensureTemplates } from './discover.js';
import { extractList, firstRecord, runtime } from './runtime.js';
import { type Plan, type Refs, refsOf, translators } from './translators.js';

export type Outcome = 'reused' | 'already exists' | 'created' | 'would create' | 'updated' | 'would update' | 'failed' | 'stopped';
export type StepLog = {
  step: string;
  object: string;
  name: string;
  outcome: Outcome;
  id?: unknown;
  warnings: string[];
  /** Plain description of an update: property before → after. */
  detail?: string;
  payload?: unknown;
  error?: string;
};
export type BuildEvent = { type: 'line'; text: string } | { type: 'step'; index: number; total: number; entry: StepLog };
export type BuildResult = {
  apply: boolean;
  ok: boolean;
  /** Apply refused because the dry run found problems (rule B1). Nothing was written. */
  refused?: boolean;
  /** Stopped on request between steps. Everything before the stop was written and checked. */
  stopped?: boolean;
  problems: string[];
  log: StepLog[];
  refs: Refs;
};
export type BuildOptions = {
  apply: boolean;
  allowWarnings?: boolean;
  freshTemplates?: boolean;
  /** Checked between steps: a stop never interrupts a write. */
  signal?: AbortSignal;
  emit?: (e: BuildEvent) => void;
};

/** Everything that should stop an apply: failed steps, warnings, failed pre-flight. */
export function problemsOf(r: BuildResult): string[] {
  return [
    ...r.problems,
    ...r.log.filter((l) => l.outcome === 'failed').map((l) => `${l.step}: ${l.error}`),
    ...r.log.flatMap((l) => l.warnings.map((w) => `${l.step}: ${w}`)),
  ];
}

/**
 * Rule B1: an apply first dry-runs the whole plan and refuses on any problem, so a plan that would fail
 * halfway never writes its first half.
 */
export async function buildWithGate(plan: Plan, opts: BuildOptions): Promise<BuildResult> {
  if (opts.apply) {
    const line = (text: string) => opts.emit?.({ type: 'line', text });
    line('Checking the whole plan first (dry run) …');
    const dry = await runBuild(plan, { ...opts, apply: false, emit: undefined });
    const problems = problemsOf(dry);
    if (problems.length && !opts.allowWarnings) {
      line(`Not applied: the dry run found ${problems.length} problem(s). Nothing was written.`);
      for (const p of problems) line(`  ${p}`);
      return { ...dry, apply: true, ok: false, refused: true, problems };
    }
    line('Dry run clean: applying.');
  }
  return runBuild(plan, { ...opts, freshTemplates: false });
}

export async function runBuild(plan: Plan, opts: BuildOptions): Promise<BuildResult> {
  const { halo } = runtime();
  const apply = opts.apply;
  const allowWarnings = Boolean(opts.allowWarnings);
  const say = (text: string) => opts.emit?.({ type: 'line', text });
  const refs: Refs = {};
  const log: StepLog[] = [];
  const done = (ok: boolean, problems: string[] = [], extra: Partial<BuildResult> = {}): BuildResult => ({ apply, ok, problems, log, refs, ...extra });

  // 1. Check order: every reference must point at an earlier step.
  const seen = new Set<string>();
  for (const step of plan.steps) {
    for (const ref of refsOf(step)) if (!seen.has(ref)) return done(false, [`Plan error: step "${step.id}" uses "${ref}" before it is defined.`]);
    seen.add(step.id);
  }

  const nameOf = (r: Record<string, unknown> | null | undefined, key = 'name') => String(r?.[key] ?? r?.name ?? '');
  async function findByName(resource: string, name: string, key = 'name'): Promise<Record<string, unknown> | undefined> {
    const rows = extractList(await halo.get(`/${resource}`));
    const want = name.trim().toLowerCase();
    // List rows don't always carry the same name property as the full record
    // (Outcome lists have `buttonname`, full records also have `outcome`), so check all of them.
    return rows.find((r) => [r[key], r.name, r.label, r.buttonname, r.outcome].some((v) => String(v ?? '').trim().toLowerCase() === want));
  }

  // Read the instance: pick templates from THIS Halo for everything the plan creates (read-only).
  say(`Reading the instance for templates${opts.freshTemplates ? ' (fresh)' : ''}:`);
  try {
    say((await ensureTemplates(plan.steps, { fresh: opts.freshTemplates })).join('\n') || '  (nothing to create)');
  } catch (e) {
    return done(false, [(e as Error).message]);
  }
  say('');

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
    say(`Pre-flight failed. Nothing was written.\n  ${missing.join('\n  ')}\n`);
    return done(false, missing.map((m) => `Pre-flight: ${m}`));
  }
  say('Pre-flight OK: everything the plan needs to find exists.\n');

  let stopped = false;
  for (const [i, step] of plan.steps.entries()) {
    const t = translators[step.object];
    const shown = step.name ?? step.match?.name ?? step.id;
    const label = `${i + 1}/${plan.steps.length} ${step.object.padEnd(16)} ${shown}`;
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const record = (entry: Omit<StepLog, 'step' | 'object' | 'name' | 'warnings'>) => {
      const full: StepLog = { step: step.id, object: step.object, name: shown, warnings, ...entry };
      log.push(full);
      opts.emit?.({ type: 'step', index: i, total: plan.steps.length, entry: full });
    };

    if (opts.signal?.aborted) {
      stopped = true;
      say(`\nStopped before step ${i + 1}. Everything before it was ${apply ? 'written and checked' : 'checked'}; run again to finish.`);
      break;
    }

    let attempted: unknown; // what was about to be sent, so a failure can be diagnosed from the run log
    try {
      if (step.action === 'reuse') {
        const found = await findByName(t.resource, step.match?.name ?? '', t.nameKey);
        if (!found) throw new Error(`No ${t.resource} named "${step.match?.name}" to reuse. Create it in Halo first.`);
        // Keep the full record so later steps can copy settings from it (e.g. a team's department, rule T3).
        const row = firstRecord(await halo.get(`/${t.resource}/${found.id}`, { includedetails: 'true' })) ?? found;
        refs[step.id] = { id: found.id as number, name: nameOf(found, t.nameKey), row };
        record({ outcome: 'reused', id: found.id });
        say(`✓ ${label}  reused id ${found.id}`);
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
            record({ outcome: 'would update', detail: 'created earlier in this plan' });
            say(`· ${label}  would update (created earlier in this plan)`);
            continue;
          }
        }
        if (!target) throw new Error(`No ${t.resource} named "${step.match?.name}" to update.`);
        // Updates are computed from the record as it is NOW (e.g. a form's existing rows, rule U2).
        const current = firstRecord(await halo.get(`/${t.resource}/${target.id}`, { includedetails: 'true' })) ?? {};
        const changes = t.update(step, refs, warn, current);
        // Drop no-op changes (value already as wanted), so "nothing to change" is reported honestly.
        // Unchanged values aren't sent. Form rows come back with display copies (group, fieldinfo) that updates never
        // send (U2): compare without them, or a re-run re-sends the whole form and Halo rewrites every row (run 3).
        const plain = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map((r) => (r && typeof r === 'object' ? (({ group: _g, fieldinfo: _f, ...rest }) => rest)(r as Record<string, unknown>) : r)) : v);
        for (const k of Object.keys(changes)) if (plain(changes[k]) === plain(current[k])) delete changes[k];
        refs[step.id] = { id: target.id as number, name: nameOf(target, t.nameKey), row: current };
        const describe = (c: Record<string, unknown>) =>
          Object.entries(c).map(([k, v]) => (Array.isArray(v) ? `${k}: ${v.length} rows (was ${Array.isArray(current[k]) ? (current[k] as unknown[]).length : 0})` : `${k}: ${JSON.stringify(current[k])} → ${JSON.stringify(v)}`)).join('; ');
        if (!Object.keys(changes).length) {
          record({ outcome: 'reused', id: target.id, detail: 'nothing to change' });
          say(`✓ ${label}  nothing to change on id ${target.id}`);
        } else if (!apply) {
          record({ outcome: 'would update', id: target.id, payload: changes, detail: describe(changes) });
          say(`· ${label}  would update id ${target.id}: ${describe(changes)}`);
        } else {
          if (warnings.length && !allowWarnings) throw new Error(`stopped before writing: ${warnings.join('; ')}`);
          attempted = [{ id: target.id, ...changes }];
          await halo.post(`/${t.resource}`, attempted as unknown[]);
          const back = firstRecord(await halo.get(`/${t.resource}/${target.id}`, { includedetails: 'true' })) ?? {};
          const bad = t.verifyUpdate
            ? t.verifyUpdate(back, changes, step, refs)
            : Object.keys(changes).filter((k) => JSON.stringify(back[k]) !== JSON.stringify(changes[k])).map((k) => `${k} is ${JSON.stringify(back[k])}, wanted ${JSON.stringify(changes[k])}`);
          for (const b of bad) warn(`Update not saved: ${b}`);
          record({ outcome: 'updated', id: target.id, payload: changes, detail: describe(changes) });
          say(`~ ${label}  updated id ${target.id}${bad.length ? '' : ', verified'}`);
        }
        // Records hanging off an updated record (e.g. rules for an added approval stage, P7/P8). Idempotent.
        if (apply && t.related) {
          const now = firstRecord(await halo.get(`/${t.resource}/${target.id}`, { includedetails: 'true' })) ?? {};
          const before: Record<string, unknown>[] = [];
          for (const r of await t.related(now, step, refs)) {
            const made = firstRecord(await halo.post(`/${r.resource}`, [typeof r.payload === 'function' ? r.payload(before) : r.payload]));
            if (made) before.push(made);
            const rb = made?.id ? firstRecord(await halo.get(`/${r.resource}/${made.id}`, { includedetails: 'true' })) : null;
            if (!rb?.id) warn(`${r.label}: not there after saving`);
            else say(`      + ${r.label} (id ${rb.id}), verified`);
          }
        } else if (!apply && t.relatedPreview) for (const x of t.relatedPreview(step, refs)) say(`      + ${x}`);
        for (const w of warnings) say(`    ! ${w}`);
        continue;
      }

      const expectedName = t.storedName?.(step) ?? step.name ?? '';
      const existing = await findByName(t.resource, expectedName, t.nameKey);
      if (existing) {
        refs[step.id] = { id: existing.id as number, name: nameOf(existing, t.nameKey) };
        record({ outcome: 'already exists', id: existing.id });
        say(`= ${label}  already exists (id ${existing.id}), reused`);
        continue;
      }

      const payload = t.build(step, refs, warn);

      if (!apply) {
        refs[step.id] = { id: `<new ${step.id}>` as unknown as number, name: step.name ?? '' };
        const extras = t.relatedPreview?.(step, refs) ?? [];
        record({ outcome: 'would create', payload, ...(extras.length ? { detail: `with ${extras.join('; ')}` } : {}) });
        say(`· ${label}  would create${extras.length ? `, with ${extras.length} related record(s)` : ''}`);
        for (const x of extras) say(`      + ${x}`);
      } else {
        if (warnings.length && !allowWarnings) throw new Error(`stopped before writing: ${warnings.join('; ')}`);
        attempted = [payload];
        const { _restore_tab_display: _r, ...toSend } = payload; // builder-only notes never go to Halo
        const created = firstRecord(await halo.post(`/${t.resource}`, [toSend]));
        if (!created?.id) throw new Error(`Halo returned no id for ${t.resource}`);
        refs[step.id] = { id: created.id as number, name: expectedName };

        // Rule F6: some objects only finish setting up on their first real save after creation.
        const follow = t.afterCreate?.(created.id as number, payload);
        if (follow) {
          try {
            await halo.post(`/${t.resource}`, [follow]);
          } catch (e) {
            warn(`Created, but the follow-up save failed: ${String((e as Error).message).split('\n')[0]} (${JSON.stringify(follow)})`);
          }
        }

        // Read back and check the name stuck: the cheapest proof it really saved.
        const back = firstRecord(await halo.get(`/${t.resource}/${created.id}`, { includedetails: 'true' }));
        const nameOk = nameOf(back, t.nameKey) === expectedName;
        if (!nameOk) warn(`Read-back mismatch: expected name "${expectedName}", got "${nameOf(back, t.nameKey)}"`);
        const extra = back && t.verifyCreate ? t.verifyCreate(back) : [];
        for (const x of extra) warn(x);
        const ok = nameOk && !extra.length;

        // Records that hang off this one (e.g. approval rules, P7): created now, each read back.
        const madeRelated: string[] = [];
        if (t.related) {
          // A related payload may be a function of the records made before it (C1: link children made just above).
          const made: Record<string, unknown>[] = [];
          for (const r of await t.related(back ?? created, step, refs)) {
            const body = typeof r.payload === 'function' ? r.payload(made) : r.payload;
            const res = firstRecord(await halo.post(`/${r.resource}`, [body]));
            const rb = res?.id ? firstRecord(await halo.get(`/${r.resource}/${res.id}`, { includedetails: 'true' })) : null;
            if (!rb?.id) throw new Error(`${r.label}: not there after saving`);
            made.push(rb);
            madeRelated.push(`${r.label} (id ${rb.id})`);
          }
          // Checks that only make sense once the related records exist (C1: the parent lists its children).
          if (t.verifyAfterRelated) {
            const again = firstRecord(await halo.get(`/${t.resource}/${created.id}`, { includedetails: 'true' })) ?? {};
            for (const x of t.verifyAfterRelated(again, step)) warn(x);
          }
        }

        record({ outcome: 'created', id: created.id, payload, ...(madeRelated.length ? { detail: `with ${madeRelated.join('; ')}` } : {}) });
        say(`+ ${label}  created id ${created.id}${ok ? ', verified' : ''}`);
        for (const x of madeRelated) say(`      + ${x}, verified`);
      }
      for (const w of warnings) say(`    ! ${w}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record({ outcome: 'failed', error: message, payload: attempted });
      say(`✗ ${label}  FAILED\n    ${message.split('\n').join('\n    ')}`);
      say('\nStopped at first failure. Nothing after this step was attempted.');
      break;
    }
  }

  // Rule F6b (2026-10-23): F6 was proven on a field that was ALREADY on a form (trial 1, field 315). The save
  // straight after creation wasn't enough on gethandoveruk (G3 dropdowns empty). So once everything is placed,
  // give every new dropdown / multi-select field one more real save (set a summary, then clear it).
  if (apply) {
    const newLists = log.filter((l) => l.outcome === 'created' && l.object === 'field' && [2, 3].includes(Number((l.payload as Record<string, unknown>)?.type)));
    if (newLists.length) {
      say(`\nFinishing ${newLists.length} dropdown field(s) (rule F6b) …`);
      for (const l of newLists) {
        try {
          await halo.post('/FieldInfo', [{ id: l.id, summary: 'finishing' }]);
          await halo.post('/FieldInfo', [{ id: l.id, summary: '' }]);
        } catch (e) {
          l.warnings.push(`F6b save failed for field ${l.id}: ${String((e as Error).message).split('\n')[0]}`);
        }
      }
    }
  }

  const failed = log.some((l) => l.outcome === 'failed');
  return done(!failed && !stopped, [], stopped ? { stopped } : {});
}
