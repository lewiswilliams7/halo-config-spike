/**
 * Learn how Halo stores the areas behind rule B2, on YOUR TRIAL, and prove the ones switched on. Nothing by hand.
 *
 *   npm run learn              read-only: reads what exists
 *   npm run learn -- --apply   also makes "zz Enact sample ..." records on the trial and runs the real builder
 *
 * Round 4 (25 Oct): finds how Halo saves child tickets (children as their own records, then linked).
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

// ---------- 2. child tickets: which way of saving children Halo accepts (round 4) ----------
// Round 3: a parent posted with NEW children inline got a bare 500. The read-back of Leaver (30) lists children as
// separate type 6 Template records (31-35). So: make each child on its own, then link them to the parent, trying the
// likely shapes in turn and recording which Halo keeps.
if (apply) {
  const area = 'child tickets ladder';
  const tpls = await list('Template');
  const byName = (n: string) => tpls.find((t) => String(t.name ?? '') === n);
  const leaver = tpls.find((t) => /leaver/i.test(String(t.name))) ?? tpls.find((t) => Number(t.id) === 30);
  const leaverFull = leaver ? await detail('Template', leaver.id) : null;
  const childRef = ((leaverFull?.children as Row[]) ?? [])[0];
  const childFull = childRef ? await detail('Template', childRef.id) : null;
  note(area, 'Halo child template (full)', childFull);
  note(area, 'Halo parent template keys', leaverFull && Object.keys(leaverFull));
  const zt = types.find((t) => String(t.name) === `${SAMPLE} request`) ?? ticketType;
  const tryPost = async (label: string, body: Row) => {
    try {
      const r = firstRecord(await haloPost('/Template', [body]));
      const back = r?.id ? await detail('Template', r.id) : null;
      note(area, label, { ok: true, id: back?.id, children: back?.children, keys_sent: Object.keys(body) });
      return back;
    } catch (e) {
      note(area, label, { ok: false, error: err(e), sent: body });
      return null;
    }
  };
  // 1. The children, each its own record, shaped like Halo's own child (cleaned).
  const kids: Row[] = [];
  for (const n of [1, 2]) {
    const name = `${SAMPLE} child ${n}`;
    const have = byName(name);
    const made = have ? await detail('Template', have.id) : await tryPost(`child ${n}: own record`, {
      ...(childFull ? cleanForCreate(childFull) : { type: 6, domain: 'reqs' }), name, summary: name, tickettype_id: zt?.id, ...(n === 1 && team ? { team: nameOf(team) } : {}), creation_rules: [],
    });
    if (made) kids.push(made);
  }
  // 2. The parent without children.
  const pname = `${SAMPLE} parent`;
  const parent = byName(pname) ? await detail('Template', byName(pname)!.id) : await tryPost('parent without children', {
    ...(leaverFull ? cleanForCreate(leaverFull) : { type: 1 }), name: pname, summary: '', tickettype_id: zt?.id,
  });
  // 3. Link: try the shapes in turn until the parent reads back with both children.
  const linked = () => ((parent?.children as Row[]) ?? []).length >= kids.length && kids.length > 0;
  if (parent && kids.length) {
    const shapes: [string, Row][] = [
      ['children as {id}', { id: parent.id, children: kids.map((k) => ({ id: k.id })) }],
      ['children as Halo rows', { id: parent.id, children: kids.map((k) => ({ ...(childRef ?? {}), id: k.id, guid: k.guid, name: k.name, summary: k.summary, tickettype_id: k.tickettype_id, creation_rules: [], rule_count: 0 })) }],
      ['children as full records', { id: parent.id, children: kids }],
    ];
    for (const [label, body] of shapes) {
      if (linked()) break;
      const back = await tryPost(`link: ${label}`, body);
      if (back) Object.assign(parent, back);
    }
    // 4. Children pointing at the parent instead (a creation rule with no condition).
    if (!linked()) {
      for (const k of kids) await tryPost(`child ${k.name}: creation rule to parent`, { id: k.id, creation_rules: [{ parent_template_id: parent.id, child_template_id: k.id, usage: 0, rule_type: 0, createonchildclose_id: -1, working_days: 0, outcome_id: 0, field_id: 0, field_value: 0, approvalstatus: 0, group_id: -1, optionalservice_id: 0 }] });
      const back = await detail('Template', parent.id);
      note(area, 'parent after creation rules', back?.children);
      if (back) Object.assign(parent, back);
    }
    note(area, 'result', { parent: parent.id, children_now: ((parent.children as Row[]) ?? []).map((c) => c.name), linked: linked() });
    summary.push(linked() ? '✓ child tickets: a way of linking children that Halo keeps was found' : '✗ child tickets: no linking shape kept (see file)');
  }
}

// Actions with a default team or agent (rule O4: Enact-made actions copied one from "Escalated").
const assigning: Row[] = [];
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
  if (String(d.defaultteam ?? '') !== '' || Number(d.defaultagent ?? 0) > 0) assigning.push({ id: d.id, name: nameOf(d), defaultteam: d.defaultteam, defaultagent: d.defaultagent_name ?? d.defaultagent });
  if (!plain && Number(d.systemid ?? 0) === 0 && !/resolv|close|approv|cancel|merge|delete/i.test(nameOf(d))) plain = d;
}
note('actions', 'sendemail combinations (action names)', combos);
note('actions', 'actions with a default team or agent (O4)', assigning);
note('actions', 'actions that differ (full)', emailFull);
summary.push(`· actions: ${Object.keys(combos).length} sendemail combinations across ${outcomes.length} actions`);
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
