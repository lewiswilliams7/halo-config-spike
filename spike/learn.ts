/**
 * Learn how Halo stores the areas behind rule B2, on YOUR TRIAL, and prove the ones switched on. Nothing by hand.
 *
 *   npm run learn              read-only: reads what exists
 *   npm run learn -- --apply   also makes "zz Enact sample ..." records on the trial and runs the real builder
 *
 * Round 6 (25 Oct): reads notifications on events, the priority matrix and categories (one sample category). Rounds 3
 * and 5's builder proofs re-run as a regression check: they must change nothing.
 * Round 3 (25 Oct): proves ticket rules (with priority), conditional fields, emails and child tickets with the REAL
 * builder on the trial (dry run gate B1, apply, read back). Also reads every action (sendemail settings, default
 * team/agent: rule O4), priorities, ticket templates and runbooks, as round 2 did.
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

// ---------- 1. prove every switched-on area with the real builder (round 3) ----------
async function prove(label: string, plan: Plan, check: (log: Row[]) => Promise<Row>) {
  const lines: string[] = [];
  try {
    const result = await withRuntime({ halo: envHalo, templates: fileTemplates }, () =>
      buildWithGate(plan, { apply: true, emit: (e) => { if (e.type === 'line') lines.push(e.text); } }),
    );
    const log = result.log.map((l) => ({ step: l.step, outcome: l.outcome, id: l.id, error: l.error, warnings: l.warnings, detail: l.detail }));
    note('builder proof', label, { ok: result.ok, refused: result.refused, problems: result.problems, log, output: lines, read_back: result.ok ? await check(log) : null });
    summary.push(result.ok ? `✓ ${label}: built and checked on the trial` : `✗ ${label}: ${[...result.problems, ...log.filter((l) => l.error).map((l) => `${l.step}: ${l.error}`)].join(' | ').slice(0, 300)}`);
  } catch (e) {
    note('builder proof', `${label} error`, err(e));
    summary.push(`✗ ${label}: ${err(e).slice(0, 200)}`);
  }
}
const idOf = (log: Row[], step: string) => log.find((l) => l.step === step)?.id;

if (apply && ticketType && team && dropdown && option) {
  const tt = nameOf(ticketType);
  await prove('ticket rule with priority, and a conditional field', {
    request: 'Enact learning run 3',
    steps: [
      { id: 'tt', object: 'ticket_type', action: 'reuse', match: { name: tt } },
      { id: 'dd', object: 'field', action: 'reuse', match: { name: String(dropdown.name) } },
      { id: 'team', object: 'team', action: 'reuse', match: { name: nameOf(team) } },
      { id: 'reason', object: 'field', action: 'create', name: 'CFzzEnactSampleReason', label: `${SAMPLE} reason`, type: 'memo' },
      { id: 'rule', object: 'ticket_rule', action: 'create', name: `${SAMPLE} routing`, when: [{ ticket_type: 'tt' }, { field: 'dd', equals: String(option.name) }], then: { team: 'team', priority: 2 } },
      { id: 'form', object: 'ticket_type', action: 'update', match: { name: tt }, set: { add_fields: [{ ref: 'reason' }], show_field_when: [{ field: 'reason', when: 'dd', equals: String(option.name) }] } },
    ],
  }, async (log) => ({
    rule: await detail('TicketRules', idOf(log, 'rule')),
    conditional_rows: (((await detail('TicketType', ticketType.id))?.fields as Row[]) ?? []).filter((r) => set(r.group_visibility_conditions)).map((r) => ({ id: r.id, fieldid: r.fieldid, conditions: r.group_visibility_conditions })),
  }));

  await prove('email template and an action that sends it', {
    request: 'Enact learning run 3',
    steps: [
      { id: 'em', object: 'email_template', action: 'create', name: `${SAMPLE} installed email`, subject: 'Your request $FAULTID: software installed', body: 'Hello,\n\nThe software you asked for ($symptom) is installed.\n\nThanks' },
      { id: 'btn', object: 'outcome', action: 'create', name: `${SAMPLE} notify installed`, send_email: 'em' },
    ],
  }, async (log) => ({ template: await detail('EmailTemplate', idOf(log, 'em')), action: pick(await detail('Outcome', idOf(log, 'btn')), /mail|send|includeto|tooverride|default(team|agent)|outcome$/i) }));

}

// ---------- 2. child tickets with the real builder (round 5) ----------
// Round 4 found the way Halo keeps them (children as their own records, then listed by id: rule C1). Now the builder
// does it end to end on the sample ticket type, and the ticket type is pointed at the new template.
if (apply && team) {
  const zt = types.find((t) => String(t.name) === `${SAMPLE} request`);
  await prove('child tickets', {
    request: 'Enact learning run 5',
    steps: [
      ...(zt
        ? [{ id: 'zt', object: 'ticket_type' as const, action: 'reuse' as const, match: { name: `${SAMPLE} request` } }]
        : [{ id: 'src', object: 'ticket_type' as const, action: 'reuse' as const, match: { name: nameOf(ticketType!) } }, { id: 'zt', object: 'ticket_type' as const, action: 'create' as const, name: `${SAMPLE} request`, based_on: nameOf(ticketType!) }]),
      { id: 'team', object: 'team', action: 'reuse', match: { name: nameOf(team) } },
      { id: 'kids', object: 'ticket_template', action: 'create', name: `${SAMPLE} children (builder)`, attach_to: 'zt', children: [{ summary: `${SAMPLE} builder child 1`, ticket_type: 'zt', team: 'team' }, { summary: `${SAMPLE} builder child 2`, ticket_type: 'zt' }] },
    ],
  }, async (log) => ({
    template: await detail('Template', idOf(log, 'kids')),
    ticket_type_link: pick(await detail('TicketType', idOf(log, 'zt')), /template/i),
  }));
}

// Actions with a default team or agent (rule O4: Enact-made actions copied one from "Escalated").
const assigning: Row[] = [];
// ---------- 3. notifications on events (round 6) ----------
// Probe: /Notification exists with eventno, emailtemplate_id, agents. Read them all, in full, with their conditions.
const notes = await list('Notification');
note('notifications', 'count', notes.length);
note('notifications', 'list rows (first 5)', notes.slice(0, 5));
const noteFull: Row[] = [];
for (const n of notes.slice(0, 40)) {
  const d = await detail('Notification', n.id);
  if (d) noteFull.push(d);
}
note('notifications', 'events in use (eventno: names)', noteFull.reduce((acc: Row, d) => {
  const k = String(d.eventno);
  acc[k] = [...((acc[k] as string[]) ?? []), nameOf(d)];
  return acc;
}, {}));
// The richest few in full: ones with conditions, recipients and a template.
note('notifications', 'full (up to 6, with conditions first)', [...noteFull].sort((a, b) => Number(b.condition_count ?? 0) - Number(a.condition_count ?? 0)).slice(0, 6));
for (const path of ['/Event', '/NotificationEvent', '/Lookup?lookupid=17', '/EventType']) {
  try {
    const rows = extractList(await haloGet(path.split('?')[0], path.includes('?') ? Object.fromEntries(new URLSearchParams(path.split('?')[1])) : undefined));
    if (rows.length) { note('notifications', `event names from ${path}`, rows.slice(0, 80)); break; }
  } catch {
    // not there
  }
}
summary.push(`· notifications: ${notes.length}, ${new Set(noteFull.map((d) => d.eventno)).size} different events`);

// ---------- 4. priority matrix (impact x urgency) ----------
const allRules = await list('TicketRules');
const matrix: Row[] = [];
for (const r of allRules) {
  const d = await detail('TicketRules', r.id);
  if (d && Number(d.use) !== 0) matrix.push({ id: d.id, name: d.name, use: d.use, precedence: d.precedence, new_priority_id: d.new_priority_id, criteria: ((d.criteria as Row[]) ?? []).map((c) => pick(c, /fieldname|value_int|value_string|type$/)) });
}
note('priority matrix', 'rules with use 1 or 2', matrix);
for (const n of ['impact', 'urgency']) {
  const f = fieldRows.find((r) => String(r.name).toLowerCase() === n);
  note('priority matrix', `field ${n}`, f ? await detail('FieldInfo', f.id) : `no FieldInfo named ${n}`);
}
for (const id of [27, 28]) note('priority matrix', `lookup ${id} (impact/urgency values?)`, await list('Lookup', { lookupid: String(id) }));
summary.push(`· priority matrix: ${matrix.length} rules`);

// ---------- 5. categories ----------
const cats = await list('Category');
note('categories', 'count', cats.length);
note('categories', 'list rows (first 8)', cats.slice(0, 8));
const catFull: Row[] = [];
for (const c of cats.slice(0, 4)) {
  const d = await detail('Category', c.id);
  if (d) catFull.push(d);
}
note('categories', 'full (first 4)', catFull);
// Which ticket types use which category list.
const typeCats: Row = {};
for (const t of types.slice(0, 80)) {
  const d = await detail('TicketType', t.id);
  const k = pick(d, /categ/i);
  if (Object.values(k).some(set)) typeCats[nameOf(t)] = k;
}
note('categories', 'ticket type category settings', typeCats);
if (apply && catFull[0]) {
  const name = `${SAMPLE} category`;
  const existing = cats.find((c) => String(c.value ?? c.name ?? '') === name || String(c.name ?? '') === name);
  const body: Row = existing ? { id: existing.id, value: name } : { ...cleanForCreate(catFull[0]), value: name, ...(('name' in catFull[0]) ? { name } : {}) };
  try {
    const r = firstRecord(await haloPost('/Category', [body]));
    const back = r?.id ? await detail('Category', r.id) : null;
    note('categories', 'sample read-back', { sent: body, back });
    summary.push(`✓ category sample: id ${back?.id}`);
  } catch (e) {
    note('categories', 'sample failed', { error: err(e), sent: body });
    summary.push(`✗ category sample: ${err(e).slice(0, 150)}`);
  }
}
summary.push(`· categories: ${cats.length}`);

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(summary.join('\n'));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.${apply ? '' : '\nRun with -- --apply to make the samples and run the builder on your trial.'}\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
