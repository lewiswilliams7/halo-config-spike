/**
 * Learn how Halo stores the areas behind rule B2, on YOUR TRIAL, and prove the ones switched on. Nothing by hand.
 *
 *   npm run learn              read-only: reads what exists
 *   npm run learn -- --apply   also makes "zz Enact sample ..." records on the trial and runs the real builder
 *
 * Round 2 (24 Oct): round 1 settled email templates, ticket rules and conditional fields (NOTES.md). This round:
 *   - proves ticket rules and conditional fields with the REAL builder (dry run gate B1, then apply, then read back)
 *   - finds which sendemail number means "send" and who an action's email goes to
 *   - finds a priority's number (rules set new_priority_id as a number)
 *   - reads every ticket template, looking for child tickets (incl. the ones New Starter / Leaver point at)
 *   - reads runbooks (Webhook records) that aren't Halo's own AI agents
 * Writes go through haloPost (.env safety switches, trial only). Never deletes. Re-runs reuse samples by name.
 * Writes SEND-TO-CLAUDE.txt.
 */
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWithGate } from './lib/build.js';
import { cleanForCreate } from './lib/clean.js';
import { SPIKE_DIR, assertWritesAllowed, env, envHalo, extractList, fileTemplates, firstRecord, haloGet, haloPost } from './lib/halo.js';
import { withRuntime } from './lib/runtime.js';
import type { Plan } from './lib/translators.js';

type Row = Record<string, unknown>;
const apply = process.argv.includes('--apply');
if (apply) assertWritesAllowed();

const SAMPLE = 'zz Enact sample';
const out: Record<string, unknown> = { instance: env.apiUrl, learned_at: new Date().toISOString(), round: 2, apply };
const summary: string[] = [];
const note = (area: string, key: string, value: unknown) => {
  const a = (out[area] ??= {}) as Row;
  a[key] = value;
};
const err = (e: unknown) => String((e as Error).message ?? e).split('\n').slice(0, 3).join(' ').slice(0, 600);
const nameOf = (r: Row) => String(r.name ?? r.outcome ?? r.buttonname ?? r.label ?? r.id ?? '');

async function list(resource: string, params?: Record<string, string>): Promise<Row[]> {
  try {
    return extractList(await haloGet(`/${resource}`, params));
  } catch (e) {
    note(resource, 'list error', err(e));
    return [];
  }
}
async function detail(resource: string, id: unknown): Promise<Row | null> {
  try {
    return firstRecord(await haloGet(`/${resource}/${id}`, { includedetails: 'true' }));
  } catch (e) {
    note(resource, `detail ${id} error`, err(e));
    return null;
  }
}
const pick = (r: Row | null, re: RegExp) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => re.test(k)));
const set = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== -1 && !(Array.isArray(v) && !v.length);

console.log(`\nLearning from ${env.apiUrl} ${apply ? '(will make samples and run the builder on the trial)' : '(read-only)'}\n`);

// ---------- reference data ----------
const types = await list('TicketType');
const teams = await list('Team');
const fieldRows = await list('FieldInfo');
const ticketType = types.find((t) => /software licen/i.test(nameOf(t))) ?? types.find((t) => Number(t.id) > 0);
const team = teams.find((t) => /1st line/i.test(nameOf(t))) ?? teams[0];
let dropdown: Row | null = null;
for (const f of [...fieldRows.filter((r) => /licen/i.test(String(r.label ?? r.name))), ...fieldRows.filter((r) => String(r.name ?? '').startsWith('CF')).slice(0, 40)]) {
  const d = await detail('FieldInfo', f.id);
  if (d && Number(d.type) === 2 && Array.isArray(d.values) && d.values.length > 1) { dropdown = d; break; }
}
const option = (dropdown?.values as Row[] | undefined)?.at(-1);
note('reference', 'picked', { ticket_type: ticketType && nameOf(ticketType), team: team && nameOf(team), dropdown: dropdown && `${dropdown.name} "${dropdown.label}" = ${option?.name}` });

// ---------- 1. prove ticket rules and conditional fields with the real builder ----------
if (apply && ticketType && team && dropdown && option) {
  const plan: Plan = {
    request: 'Enact learning run: prove ticket rules and conditional fields',
    steps: [
      { id: 'tt', object: 'ticket_type', action: 'reuse', match: { name: nameOf(ticketType) } },
      { id: 'dd', object: 'field', action: 'reuse', match: { name: String(dropdown.name) } },
      { id: 'team', object: 'team', action: 'reuse', match: { name: nameOf(team) } },
      { id: 'reason', object: 'field', action: 'create', name: 'CFzzEnactSampleReason', label: `${SAMPLE} reason`, type: 'memo' },
      { id: 'rule', object: 'ticket_rule', action: 'create', name: `${SAMPLE} routing`, when: [{ ticket_type: 'tt' }, { field: 'dd', equals: String(option.name) }], then: { team: 'team' } },
      { id: 'form', object: 'ticket_type', action: 'update', match: { name: nameOf(ticketType) }, set: { add_fields: [{ ref: 'reason' }], show_field_when: [{ field: 'reason', when: 'dd', equals: String(option.name) }] } },
    ],
  };
  // The dropdown must be on the form for the condition to make sense; if it isn't, the builder says so (and stops).
  const lines: string[] = [];
  try {
    const result = await withRuntime({ halo: envHalo, templates: fileTemplates }, () =>
      buildWithGate(plan, { apply: true, emit: (e) => { if (e.type === 'line') lines.push(e.text); } }),
    );
    note('builder proof', 'result', { ok: result.ok, refused: result.refused, problems: result.problems, log: result.log.map((l) => ({ step: l.step, outcome: l.outcome, id: l.id, error: l.error, warnings: l.warnings, detail: l.detail })) });
    note('builder proof', 'output', lines);
    const rule = result.log.find((l) => l.step === 'rule');
    if (rule?.id) note('builder proof', 'rule read-back', await detail('TicketRules', rule.id));
    const form = await detail('TicketType', ticketType.id);
    note('builder proof', 'form rows with conditions', ((form?.fields as Row[]) ?? []).filter((r) => set(r.group_visibility_conditions)).map((r) => ({ id: r.id, fieldid: r.fieldid, conditions: r.group_visibility_conditions })));
    summary.push(result.ok ? '✓ builder proof: ticket rule and conditional field built and checked on the trial' : `✗ builder proof: ${[...result.problems, ...result.log.filter((l) => l.error).map((l) => `${l.step}: ${l.error}`)].join(' | ').slice(0, 300)}`);
  } catch (e) {
    note('builder proof', 'error', err(e));
    summary.push(`✗ builder proof: ${err(e).slice(0, 200)}`);
  }
}

// ---------- 2. which sendemail number sends, and who to ----------
const outcomes = await list('Outcome');
const combos: Record<string, string[]> = {};
const emailFull: Row[] = [];
let plain: Row | null = null;
for (const o of outcomes) {
  const d = await detail('Outcome', o.id);
  if (!d) continue;
  const key = `sendemail=${d.sendemail} hidesendemail=${d.hidesendemail} template=${Number(d.emailtemplate_id) > 0 ? 'yes' : 'no'}`;
  (combos[key] ??= []).push(nameOf(d));
  if ((Number(d.sendemail) !== 2 || Number(d.emailtemplate_id) > 0) && emailFull.length < 4) emailFull.push(d);
  if (!plain && Number(d.systemid ?? 0) === 0 && !/resolv|close|approv|cancel|merge|delete/i.test(nameOf(d))) plain = d;
}
note('actions', 'sendemail combinations (action names)', combos);
note('actions', 'actions that differ (full)', emailFull);
summary.push(`· actions: ${Object.keys(combos).length} sendemail combinations across ${outcomes.length} actions`);
if (apply && plain) {
  const email = (await list('EmailTemplate')).find((t) => String(t.name ?? '').startsWith(SAMPLE));
  const name = `${SAMPLE} email action`;
  const existing = outcomes.find((o) => [o.outcome, o.buttonname, o.name].some((v) => String(v ?? '') === name));
  const payload: Row = {
    ...(existing ? { id: existing.id } : cleanForCreate(plain)),
    outcome: name, buttonname: name, systemid: 0, hotkey: '', newstatus: 0,
    sendemail: 1, hidesendemail: false,
    ...(email ? { emailtemplate_id: email.id } : {}),
  };
  try {
    const res = firstRecord(await haloPost('/Outcome', [payload]));
    const back = res?.id ? await detail('Outcome', res.id) : null;
    note('actions', 'sample (sendemail 1) read-back', back);
    summary.push(`✓ email action sample: id ${back?.id} (sendemail ${back?.sendemail}, template ${back?.emailtemplate_id})`);
  } catch (e) {
    note('actions', 'sample failed', { error: err(e), sent: payload });
    summary.push(`✗ email action sample: ${err(e).slice(0, 150)}`);
  }
}

// ---------- 3. a priority's number ----------
const prios = await list('Priority');
note('priorities', 'list rows (first 6)', prios.slice(0, 6));
if (prios[0]) note('priorities', 'first (full)', await detail('Priority', prios[0].id));
const slas = await list('SLA');
if (slas[0]) note('priorities', 'SLA priorities rows', ((await detail('SLA', slas[0].id))?.priorities as Row[] | undefined)?.slice(0, 4));
const rules = await list('TicketRules');
note('priorities', 'rules that set a priority', (await Promise.all(rules.slice(0, 20).map((r) => detail('TicketRules', r.id)))).filter((d) => Number(d?.new_priority_id) > 0).map((d) => pick(d, /^name$|priority/i)));

// ---------- 4. child tickets: every template ----------
const tpls = await list('Template');
const withChildren: Row[] = [];
const childKeys = new Set<string>();
for (const t of tpls) {
  const d = await detail('Template', t.id);
  if (!d) continue;
  Object.keys(d).filter((k) => /child|parent|sub/i.test(k)).forEach((k) => childKeys.add(k));
  if (Object.entries(d).some(([k, v]) => /child/i.test(k) && Array.isArray(v) && v.length) && withChildren.length < 2) withChildren.push(d);
}
note('child tickets', 'template keys about children', [...childKeys]);
note('child tickets', 'templates with children (full)', withChildren);
const linked: Row = {};
for (const t of types) {
  const d = await detail('TicketType', t.id);
  const id = Number(d?.overridewiththefollowingtemplatewhenloggingmanually ?? -1);
  if (id > 0 && Object.keys(linked).length < 3) linked[nameOf(t)] = await detail('Template', id);
}
note('child tickets', 'templates ticket types point at (full)', linked);
summary.push(`· child tickets: ${withChildren.length} template(s) with children out of ${tpls.length}`);

// ---------- 5. runbooks ----------
const hooks = await list('Webhook');
note('runbooks', 'all (name, type)', hooks.map((h) => ({ id: h.id, name: h.name, type: h.type })));
const own = hooks.filter((h) => !/halo ai/i.test(String(h.name)));
for (const h of own.slice(0, 2)) note('runbooks', `full: ${h.name}`, await detail('Webhook', h.id));
summary.push(`· runbooks: ${hooks.length} (${own.length} not Halo AI)`);

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(summary.join('\n'));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.${apply ? '' : '\nRun with -- --apply to make the samples and run the builder on your trial.'}\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
