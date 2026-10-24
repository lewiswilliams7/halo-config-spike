/**
 * Learn how Halo stores the areas behind rule B2 (emails, ticket rules, child tickets, section visibility, runbooks)
 * by making samples on YOUR TRIAL and reading back what Halo kept. Nothing is made by hand.
 *
 *   npm run learn              read-only: what exists already (and Halo's API description, if it serves one)
 *   npm run learn -- --apply   also creates "zz Enact sample ..." records on the trial and reads them back
 *
 * Writes go through haloPost, so the .env safety switches apply (trial only). Never deletes. Re-running reuses the
 * samples by name instead of making more. Every experiment is independent: one failing doesn't stop the rest.
 * Writes SEND-TO-CLAUDE.txt: the evidence that fills SPIKE_MAP.
 */
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanForCreate } from './lib/clean.js';
import { SPIKE_DIR, assertWritesAllowed, env, extractList, firstRecord, haloGet, haloPost, saveJson } from './lib/halo.js';

type Row = Record<string, unknown>;
const apply = process.argv.includes('--apply');
if (apply) assertWritesAllowed();

const SAMPLE = 'zz Enact sample';
const out: Record<string, unknown> = { instance: env.apiUrl, learned_at: new Date().toISOString(), apply };
const summary: string[] = [];
const note = (area: string, key: string, value: unknown) => {
  const a = (out[area] ??= {}) as Row;
  a[key] = value;
};
const err = (e: unknown) => String((e as Error).message ?? e).split('\n').slice(0, 3).join(' ').slice(0, 600);
const nameOf = (r: Row) => String(r.name ?? r.outcome ?? r.buttonname ?? r.header_text ?? r.label ?? r.id ?? '');

async function list(resource: string): Promise<Row[]> {
  try {
    return extractList(await haloGet(`/${resource}`));
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
/** Keys whose name matches, with their values (to see what a record holds about one topic). */
const pick = (r: Row | null, re: RegExp) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => re.test(k)));
/** Which keys we sent came back as sent. */
function kept(sent: Row, back: Row | null): Row {
  const res: Row = {};
  for (const [k, v] of Object.entries(sent)) {
    if (k === 'id') continue;
    const b = back?.[k];
    res[k] = JSON.stringify(b) === JSON.stringify(v) || String(b) === String(v) ? 'kept' : { sent: v, got: b ?? '(missing)' };
  }
  return res;
}
/** Create or update a sample (found by name first, so re-runs don't make more). Returns the read-back. */
async function sample(area: string, resource: string, name: string, nameKeys: string[], payload: Row): Promise<Row | null> {
  const existing = (await list(resource)).find((r) => nameKeys.some((k) => String(r[k] ?? '') === name));
  const body = existing ? { ...payload, id: existing.id } : payload;
  try {
    const res = firstRecord(await haloPost(`/${resource}`, [body]));
    const id = res?.id ?? existing?.id;
    const back = id ? await detail(resource, id) : null;
    note(area, `${existing ? 'updated' : 'created'} ${name}`, { id, kept: kept(payload, back), read_back: back });
    if (back) saveJson(`fixtures/learn/${resource.toLowerCase()}-${id}.json`, back);
    return back;
  } catch (e) {
    note(area, `POST ${name} failed`, { error: err(e), sent: body });
    summary.push(`✗ ${area}: Halo refused "${name}" (${err(e).slice(0, 120)})`);
    return null;
  }
}
/** A clean copy of an existing record to start a sample from (Halo's own shape), or a bare object. */
const startFrom = (r: Row | null): Row => (r ? cleanForCreate(r) : {});

console.log(`\nLearning from ${env.apiUrl} ${apply ? '(will create samples on the trial)' : '(read-only)'}\n`);

// ---------- Halo's own API description, if the instance serves one ----------
for (const path of ['/swagger/v1/swagger.json', '/swagger.json', '/apidoc/swagger.json', '/openapi.json']) {
  try {
    const doc = (await haloGet(path)) as Row;
    const schemas = ((doc?.components as Row)?.schemas ?? doc?.definitions ?? {}) as Row;
    const wanted = Object.fromEntries(Object.entries(schemas).filter(([k]) => /emailtemplate|outcome|ticketrule|^template|integration|runbook|fieldgroup|tickettype_?field|criteria/i.test(k)));
    if (Object.keys(wanted).length) {
      note('api description', path, wanted);
      summary.push(`✓ API description at ${path}: ${Object.keys(wanted).length} relevant models`);
      break;
    }
  } catch {
    // not served there
  }
}

// ---------- reference data from the instance ----------
const teams = await list('Team');
const priorities = await list('Priority');
const types = await list('TicketType');
const fieldRows = await list('FieldInfo');
const team = teams.find((t) => /finance/i.test(nameOf(t))) ?? teams[0];
const priority = priorities[1] ?? priorities[0];
const ticketType = types.find((t) => /software licen/i.test(nameOf(t))) ?? types.find((t) => Number(t.id) > 0);
// A dropdown with options, for conditions: "Number of licences" if there is one.
let dropdown: Row | null = null;
for (const f of [...fieldRows.filter((r) => /licen/i.test(String(r.label ?? r.name))), ...fieldRows.filter((r) => String(r.name ?? '').startsWith('CF')).slice(0, 40)]) {
  const d = await detail('FieldInfo', f.id);
  if (d && Number(d.type) === 2 && Array.isArray(d.values) && d.values.length) { dropdown = d; break; }
}
const option = (dropdown?.values as Row[] | undefined)?.at(-1);
note('reference', 'picked', { team: team && nameOf(team), priority: priority && nameOf(priority), ticket_type: ticketType && nameOf(ticketType), dropdown: dropdown && `${dropdown.label} = ${option?.name}` });
const criterion = dropdown && option
  ? { tablename: 'faults', fieldname: String(dropdown.name), value_type: 'int', value_int: 0, value_string: String(option.id), value_display: String(option.name), type: 23 }
  : null;

// ---------- 1. email templates ----------
const templates = await list('EmailTemplate');
note('email templates', 'count', templates.length);
note('email templates', 'list rows (first 3)', templates.slice(0, 3));
const ticketEmail = templates.find((t) => !/invoice|quote|order|report|contract|survey|password/i.test(nameOf(t))) ?? templates[0];
const emailShape = ticketEmail ? await detail('EmailTemplate', ticketEmail.id) : null;
note('email templates', 'existing (shape)', emailShape);
let sampleEmail: Row | null = null;
if (apply) {
  const name = `${SAMPLE} email`;
  sampleEmail = await sample('email templates', 'EmailTemplate', name, ['name', 'header_text', 'description'], {
    ...startFrom(emailShape),
    name,
    header_text: 'Enact sample: your request $FAULTID',
    body_html: '<p>Enact sample body for ticket $FAULTID.</p>',
  });
  if (sampleEmail) summary.push(`✓ email template: id ${sampleEmail.id}`);
}

// ---------- 2. actions that send an email ----------
const outcomes = await list('Outcome');
const emailing: Row[] = [];
let plain: Row | null = null;
for (const o of outcomes.slice(0, 80)) {
  const d = await detail('Outcome', o.id);
  if (!d) continue;
  if (d.sendemail === true || Number(d.sendemail) > 0 || Number(d.emailtemplate_id) > 0) emailing.push(d);
  if (!plain && Number(d.systemid ?? 0) === 0 && !/resolv|close|approv|cancel|merge|delete/i.test(nameOf(d))) plain = d;
}
const EMAIL_KEYS = /mail|send|recipient|to_|_to$|cc|bcc|notify|template|contact|user/i;
note('actions', 'existing that send email (email-related keys)', emailing.slice(0, 4).map((d) => ({ id: d.id, name: nameOf(d), keys: pick(d, EMAIL_KEYS) })));
note('actions', 'a plain action (email-related keys)', plain && { id: plain.id, name: nameOf(plain), keys: pick(plain, EMAIL_KEYS) });
if (apply && plain) {
  const name = `${SAMPLE} email action`;
  const back = await sample('actions', 'Outcome', name, ['outcome', 'buttonname'], {
    ...startFrom(plain),
    outcome: name,
    buttonname: name,
    systemid: 0,
    hotkey: '',
    newstatus: 0,
    sendemail: true,
    ...(sampleEmail ? { emailtemplate_id: sampleEmail.id } : {}),
  });
  if (back) {
    note('actions', 'sample email-related keys after saving', pick(back, EMAIL_KEYS));
    summary.push(`✓ email action: id ${back.id}`);
  }
}

// ---------- 3. ticket rules ----------
const rules = await list('TicketRules');
note('ticket rules', 'count', rules.length);
const ruleDetails = [];
for (const r of rules.slice(0, 4)) ruleDetails.push(await detail('TicketRules', r.id));
note('ticket rules', 'existing (full)', ruleDetails);
if (apply) {
  const name = `${SAMPLE} rule`;
  // Phase 1: a rule with one condition, shaped like an existing one (or bare): Halo answers with every key it has.
  const first = await sample('ticket rules', 'TicketRules', name, ['name'], {
    ...startFrom(ruleDetails[0] ?? null),
    name,
    ...(criterion ? { criteria: [criterion] } : {}),
  });
  if (first) {
    // Phase 2: set every key that looks like "what the rule changes" or "which ticket type", from the read-back.
    const set: Row = {};
    for (const k of Object.keys(first)) {
      if (/name$|display/i.test(k)) continue;
      if (/team/i.test(k) && /^new_|_id$|^team$/i.test(k) && team) set[k] = /_id$|id$/i.test(k) ? team.id : nameOf(team);
      if (/priority|^new_pri|pri_id/i.test(k) && priority) set[k] = priority.id;
      if (/tickettype|requesttype/i.test(k) && ticketType) set[k] = ticketType.id;
    }
    note('ticket rules', 'phase 2 candidate keys', set);
    if (Object.keys(set).length) {
      try {
        await haloPost('/TicketRules', [{ id: first.id, ...set }]);
        const back = await detail('TicketRules', first.id);
        note('ticket rules', 'phase 2 result', { kept: kept(set, back), read_back: back });
        summary.push(`✓ ticket rule: id ${first.id}, ${Object.keys(set).length} candidate keys tried`);
      } catch (e) {
        note('ticket rules', 'phase 2 failed', err(e));
        summary.push(`✗ ticket rule phase 2: ${err(e).slice(0, 120)}`);
      }
    } else summary.push(`✓ ticket rule: id ${first.id} (no candidate keys to try)`);
    // Phase 3: a ticket type condition as a criteria row, to see whether Halo recognises it (fills its display).
    if (ticketType && criterion) {
      try {
        const rows = [criterion, { tablename: 'faults', fieldname: 'requesttype', value_type: 'int', value_int: Number(ticketType.id), value_string: '', value_display: '', type: 0 }];
        await haloPost('/TicketRules', [{ id: first.id, criteria: rows }]);
        note('ticket rules', 'phase 3 (ticket type as a criteria row)', (await detail('TicketRules', first.id))?.criteria);
      } catch (e) {
        note('ticket rules', 'phase 3 failed', err(e));
      }
    }
  }
}

// ---------- 4. ticket templates (child tickets) ----------
const tpls = await list('Template');
note('ticket templates', 'count', tpls.length);
const tplDetails: Row[] = [];
for (const t of tpls.slice(0, 6)) {
  const d = await detail('Template', t.id);
  if (d) tplDetails.push(d);
}
const withChildren = tplDetails.find((d) => Object.entries(d).some(([k, v]) => /child/i.test(k) && Array.isArray(v) && v.length));
note('ticket templates', 'existing (child-related keys)', tplDetails.map((d) => ({ id: d.id, name: nameOf(d), keys: pick(d, /child|parent|tickettype|requesttype|team|summary|template/i) })));
note('ticket templates', 'one with children (full)', withChildren ?? null);
const typeLinks: Row = {};
for (const t of types.slice(0, 60)) {
  const d = await detail('TicketType', t.id);
  const links = Object.fromEntries(Object.entries(pick(d, /template/i)).filter(([, v]) => v !== null && v !== '' && v !== 0 && v !== -1 && !(Array.isArray(v) && !v.length)));
  if (Object.keys(links).length) typeLinks[`${t.id} ${nameOf(t)}`] = links;
}
note('ticket templates', 'ticket type keys pointing at templates', typeLinks);
if (apply) {
  const name = `${SAMPLE} child template`;
  const childKey = withChildren ? Object.keys(withChildren).find((k) => /child/i.test(k) && Array.isArray(withChildren[k])) : undefined;
  const childRow = childKey ? cleanForCreate(((withChildren![childKey] as Row[])[0]) ?? {}) : null;
  const back = await sample('ticket templates', 'Template', name, ['name'], {
    ...startFrom(tplDetails[0] ?? null),
    name,
    ...(ticketType ? { tickettype_id: ticketType.id } : {}),
    ...(childKey && childRow ? { [childKey]: [{ ...childRow, summary: 'Enact sample child 1' }, { ...childRow, summary: 'Enact sample child 2' }] } : {}),
  });
  if (back) {
    note('ticket templates', 'sample child-related keys after saving', pick(back, /child|parent|tickettype|requesttype|template/i));
    summary.push(`✓ child template: id ${back.id}${childKey ? ` (children via ${childKey})` : ' (no existing template with children to copy the shape from)'}`);
  }
}

// ---------- 5. showing a section only for some answers ----------
const conditional: Row[] = [];
const rowKeys = new Set<string>();
for (const t of types.slice(0, 80)) {
  const d = await detail('TicketType', t.id);
  for (const r of (d?.fields as Row[]) ?? []) {
    Object.keys(r).filter((k) => /visib|condition/i.test(k)).forEach((k) => rowKeys.add(k));
    const set = Object.entries(pick(r, /visib|condition/i)).filter(([, v]) => v !== null && v !== '' && v !== 0 && v !== '[]' && !(Array.isArray(v) && !v.length));
    if (set.length && conditional.length < 6) conditional.push({ ticket_type: nameOf(t), row: { ...r, group: undefined, fieldinfo: (r.fieldinfo as Row)?.name } });
  }
}
note('section visibility', 'keys on form rows', [...rowKeys]);
note('section visibility', 'rows that have a condition', conditional);
summary.push(conditional.length ? `✓ section conditions found on ${conditional.length} form row(s)` : '· no section conditions on this instance yet');
if (apply && !conditional.length && ticketType && dropdown && option) {
  // No example anywhere: try the obvious shape on a SAMPLE section on the sample-friendly ticket type, and read back.
  const tt = await detail('TicketType', ticketType.id);
  const sectionRow = ((tt?.fields as Row[]) ?? []).find((r) => Number(r.fieldid) === 0 && Number(r.groupid) > 0);
  if (sectionRow) {
    const rows = ((tt!.fields as Row[]) ?? []).map((r) => {
      const { group: _g, fieldinfo: _f, ...rest } = r;
      return r === sectionRow ? { ...rest, group_visibility_conditions: [{ fieldname: dropdown!.name, value_int: Number(option.id), value_string: String(option.id), value_display: option.name, type: 23 }], group_visibility_conditions_value: String(option.id) } : rest;
    });
    note('section visibility', 'experiment', { ticket_type: nameOf(ticketType), section_row: sectionRow.id, note: 'shape guessed; the read-back shows what Halo kept' });
    try {
      await haloPost('/TicketType', [{ id: ticketType.id, fields: rows }]);
      const back = await detail('TicketType', ticketType.id);
      note('section visibility', 'experiment read-back (section row)', ((back?.fields as Row[]) ?? []).find((r) => Number(r.groupid) === Number(sectionRow.groupid) && Number(r.fieldid) === 0));
    } catch (e) {
      note('section visibility', 'experiment failed', err(e));
    }
  }
}

// ---------- 6. runbooks (read-only) ----------
for (const resource of ['CustomIntegration', 'Webhook', 'Runbook', 'IntegrationRunbook']) {
  const rows = await list(resource);
  if (!rows.length) continue;
  note('runbooks', `${resource} count`, rows.length);
  note('runbooks', `${resource} first (full)`, await detail(resource, rows[0].id));
}

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(summary.join('\n'));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.${apply ? '' : '\nRun with -- --apply to make the samples on your trial.'}\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
