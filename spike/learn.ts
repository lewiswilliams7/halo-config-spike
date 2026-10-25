/**
 * Learn how Halo stores the areas behind rule B2, on YOUR TRIAL, and prove the ones switched on. Nothing by hand.
 *
 *   npm run learn              read-only: reads what exists
 *   npm run learn -- --apply   also makes "zz Enact sample ..." records on the trial and runs the real builder
 *
 * Round 11 (25 Oct): which keys Halo keeps for a notification's conditions and team (round 10 kept neither). The
 * ticket check and earlier proofs re-run as regression checks.
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
// ---------- 3. round 9: check what the builds DO on real tickets, and learn notification conditions and teams ----------
// What the samples should have done to tickets logged since (read back from the tickets themselves, not the UI).
const recent = extractList(await haloGet('/Tickets', { pageinate: 'true', page_size: '40', page_no: '1', order: 'id', orderdesc: 'true' }).catch(() => ({})));
const typeName = new Map(types.map((t) => [Number(t.id), nameOf(t)]));
const wanted = new Set(['Software Licensing Request', `${SAMPLE} request`, `${SAMPLE} request 2`]);
const seen: Row[] = [];
for (const t of recent) {
  const tt = typeName.get(Number(t.tickettype_id)) ?? String(t.tickettype_id);
  if (!wanted.has(tt) && Number(t.parent_id ?? 0) === 0) continue;
  const d = await detail('Tickets', t.id);
  if (!d) continue;
  seen.push({
    id: d.id, ticket_type: typeName.get(Number(d.tickettype_id)) ?? d.tickettype_id, summary: d.summary, team: d.team, priority_id: d.priority_id,
    category_1: d.category_1, parent_id: d.parent_id, child_count: d.child_count ?? d.children_count, dateoccurred: d.dateoccurred,
    licences: ((d.customfields as Row[]) ?? []).filter((c) => /licen/i.test(String(c.name))).map((c) => c.display ?? c.value),
  });
  if (seen.length >= 15) break;
}
note('tickets', 'recent sample-related tickets (what the builds did)', seen);
note('tickets', 'keys on a ticket (first)', recent[0] ? Object.keys(recent[0]) : []);
summary.push(`· tickets: ${seen.length} recent sample-related tickets read`);

// ---------- round 11: which keys Halo keeps for a notification's conditions and team (N3) ----------
// Round 10: posting conditions[] and team_name on create kept NEITHER. Try each candidate on its own, on the
// sample notification 3 (nobody subscribed, so it never fires), and read back what stuck.
if (apply && ticketType) {
  const area = 'notification ladder';
  const notes = await list('Notification');
  const n3 = notes.find((n) => String(n.name) === `${SAMPLE} notification 3`);
  const teams = await list('Team');
  const slTeam = teams.find((t) => /software licen/i.test(nameOf(t))) ?? teams[0];
  if (n3 && slTeam) {
    const row = { fieldname: 'RequestType', fieldid: 1, change_context: 0, type: 0, value_int: Number(ticketType.id), value_string: '', value_display: nameOf(ticketType), value_type: 'int', tablename: 'faults' };
    const tries: [string, Row, (b: Row | null) => boolean][] = [
      ['conditions with rule_id', { conditions: [{ ...row, rule_id: n3.id }] }, (b) => ((b?.conditions as Row[]) ?? []).length > 0],
      ['conditions with condition_count', { conditions: [row], condition_count: 1 }, (b) => ((b?.conditions as Row[]) ?? []).length > 0],
      ['criteria', { criteria: [row] }, (b) => ((b?.conditions as Row[]) ?? []).length > 0 || ((b?.criteria as Row[]) ?? []).length > 0],
      ['conditions as type 23 (string id)', { conditions: [{ ...row, type: 23, value_int: 0, value_string: String(ticketType.id), value_type: 'string', rule_id: n3.id }] }, (b) => ((b?.conditions as Row[]) ?? []).length > 0],
      ['team_id', { team_id: slTeam.id }, (b) => String(b?.team_name ?? '') !== '' || Number(b?.team_id ?? 0) > 0],
      ['team (name)', { team: nameOf(slTeam) }, (b) => String(b?.team_name ?? '') !== ''],
      ['teams[]', { teams: [{ team_id: slTeam.id, team_name: nameOf(slTeam) }] }, (b) => ((b?.teams as Row[]) ?? []).length > 0 || String(b?.team_name ?? '') !== ''],
      ['type 1 + team_name', { type: 1, team_name: nameOf(slTeam) }, (b) => String(b?.team_name ?? '') !== ''],
      ['type 2 + team_name', { type: 2, team_name: nameOf(slTeam) }, (b) => String(b?.team_name ?? '') !== ''],
      ['type 0 + team_name', { type: 0, team_name: nameOf(slTeam) }, (b) => String(b?.team_name ?? '') !== ''],
    ];
    const results: Row = {};
    for (const [label, body, kept] of tries) {
      try {
        await haloPost('/Notification', [{ id: n3.id, ...body }]);
        const back = await detail('Notification', n3.id);
        results[label] = { kept: kept(back), type: back?.type, team_name: back?.team_name, conditions: back?.conditions, keys: Object.keys(back ?? {}).filter((k) => /team|cond|crit|type/i.test(k)) };
      } catch (e) {
        results[label] = { error: err(e) };
      }
    }
    note(area, 'results', results);
    const won = Object.entries(results).filter(([, r]) => (r as Row).kept).map(([k]) => k);
    summary.push(won.length ? `✓ notification keys Halo kept: ${won.join(', ')}` : '✗ notification: no candidate key kept (see file)');
    // Put it back to nobody, no conditions, so it stays inert.
    await haloPost('/Notification', [{ id: n3.id, type: -1, team_name: '', conditions: [], agents: [] }]).catch(() => undefined);
  }
}

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(summary.join('\n'));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.${apply ? '' : '\nRun with -- --apply to make the samples and run the builder on your trial.'}\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
