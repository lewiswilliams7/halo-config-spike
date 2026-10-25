/**
 * Learn how Halo stores the areas behind rule B2, on YOUR TRIAL, and prove the ones switched on. Nothing by hand.
 *
 *   npm run learn              read-only: reads what exists
 *   npm run learn -- --apply   also makes "zz Enact sample ..." records on the trial and runs the real builder
 *
 * Round 18 (25 Oct): status emails. The sample status keeps only statusemailid + notifystatuschange (nochangetemplate
 * back to -1), Enact logs a sample ticket and moves it there, then looks for Halo's background queue (where run 17's
 * acknowledgement record was) to see which emails were queued for that ticket.
 * Round 17 (25 Oct): the sample ticket again, filling whatever Halo says is mandatory (by label), the ticket's own
 * requester and their email address, and where Halo keeps sent emails (mailboxes, queue endpoints), so we can tell
 * "no email sent" from "sent but not logged as an action".
 * Round 16 (25 Oct): emails at work. Enact logs its own sample ticket (filling the type's required fields), moves it to
 * the sample status, and reads every action Halo logged (acknowledgement EM4, status email EM3). Variables re-read from
 * subjects and HTML only, as whole words (EM2: round 15's plain-text read glued words on). Sample template 46 gets
 * the ticket type's own team (C2).
 * Round 15 (25 Oct): branded emails (does Halo keep Enact's layout: rule EM1), the $variables Halo's own templates use
 * (EM2), status emails set on the status (EM3), and a sample ticket Enact logs and moves itself, to read which emails
 * Halo logged for the acknowledgement (EM4) and the status change.
 * Round 14 (25 Oct): emails to the requester on events: how ticket types (acknowledgement) and statuses use email
 * templates, experiments on the samples, and the emails Halo logged on recent tickets. Earlier proofs re-run.
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
import { BRAND_MARK, brandedEmail, variablesIn } from './lib/email-brand.js';
import type { Plan } from './lib/translators.js';

type Row = Record<string, unknown>;
const apply = process.argv.includes('--apply');
if (apply) assertWritesAllowed();

const SAMPLE = 'zz Enact sample';
const out: Record<string, unknown> = { instance: env.apiUrl, learned_at: new Date().toISOString(), round: 18, apply };
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
    template: pick(await detail('Template', idOf(log, 'kids')), /^(id|name|type|tickettype_id|team|agent_id|children)$/),
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

// ---------- round 14: emails to the requester on events (acknowledgement, status change) ----------
// 1. How this Halo does it today.
const ackTypes: Row[] = [];
for (const t of types) {
  const d = await detail('TicketType', t.id);
  const k = pick(d, /acknowledg|emailtemplate|email_template|sendemail|template_id/i);
  if (set(k.acknowledgementtemplate) || set(k.acknowledgementtemplateooh)) ackTypes.push({ ticket_type: nameOf(t), ...k });
}
note('requester emails', 'ticket types with an acknowledgement or email setting', ackTypes);
const statuses = await list('Status');
const statusEmail: Row[] = [];
for (const st of statuses) {
  const d = await detail('Status', st.id);
  const k = pick(d, /mail|template|notify|send/i);
  statusEmail.push({ status: nameOf(st), id: st.id, ...k });
}
note('requester emails', 'status email settings', statusEmail);
const tpls = await list('EmailTemplate');
const linked: Row[] = [];
for (const t of tpls) {
  const d = await detail('EmailTemplate', t.id);
  const links = Object.fromEntries(Object.entries(pick(d, /^(statuses|tickettypes|notifications|emailrules|approvalprocesses|mailboxes|outcomes)$/)).filter(([, v]) => Array.isArray(v) && v.length));
  if (Object.keys(links).length) linked.push({ template: nameOf(d ?? {}), id: t.id, header_text: d?.header_text, ...links });
  if (linked.length >= 12) break;
}
note('requester emails', 'email templates linked to statuses / ticket types', linked);
summary.push(`· requester emails: ${ackTypes.length} ticket types with an email setting, ${linked.length} templates linked`);

// 2. Experiments on the samples only (zz ticket type 70, zz email template, a new zz status).
if (apply) {
  const area = 'requester email experiments';
  const zt = types.find((t) => String(t.name) === `${SAMPLE} request`);
  const zEmail = tpls.find((t) => String(t.name) === `${SAMPLE} installed email`);
  if (zt && zEmail) {
    try {
      await haloPost('/TicketType', [{ id: zt.id, acknowledgementtemplate: zEmail.id }]);
      note(area, 'ticket type acknowledgement', pick(await detail('TicketType', zt.id), /acknowledg/i));
    } catch (e) {
      note(area, 'ticket type acknowledgement failed', err(e));
    }
  }
  // Round 15 (EM3) found Halo keeps statusemailid, notifystatuschange and nochangetemplate on the sample status.
  const zStatus = (await list('Status')).find((x) => String(x.name) === `${SAMPLE} status`);
  note(area, 'sample status now', zStatus ? pick(await detail('Status', zStatus.id), /mail|template|notify|send|freq|nochange/i) : 'not found');

  // Round 18: one key off at a time. nochangetemplate (with statusnochangehours) is the "unchanged for N hours" email,
  // so it goes back to -1; statusemailid + notifystatuschange stay, to see if entering the status queues an email.
  if (zStatus) {
    try {
      await haloPost('/Status', [{ id: zStatus.id, nochangetemplate: -1 }]);
      note(area, 'sample status for this run', pick(await detail('Status', zStatus.id), /^(statusemailid|statusemailname|notifystatuschange|nochangetemplate|statusemailfreqdays)$/));
    } catch (e) {
      note(area, 'sample status reset failed', err(e));
    }
  }

  // C2 on the old sample: template 46 predates C2 and still sends tickets to Human Resources.
  const zt46 = types.find((t) => String(t.name) === `${SAMPLE} request`);
  if (zt46) {
    try {
      const ttd = await detail('TicketType', zt46.id);
      const tplId = Number(ttd?.overridewiththefollowingtemplatewhenloggingmanually ?? 0);
      if (tplId > 0) {
        const team = String(ttd?.default_team ?? ttd?.team_name ?? '');
        await haloPost('/Template', [{ id: tplId, team }]);
        note(area, 'sample template team (C2 repair)', { template: tplId, set_to: team, now: pick(await detail('Template', tplId), /^(team|team_id)$/) });
      }
    } catch (e) {
      note(area, 'sample template team repair failed', err(e));
    }
  }

  // Round 15 (EM1): a branded email, built by the real builder, read back to see what Halo kept.
  const brand = { name: 'Enact sample', colour: '#1652F0', logo_url: 'https://placehold.co/240x48/png?text=Enact+sample', footer: 'Enact sample service desk\nReference $FAULTID' };
  await prove('branded email template', {
    request: 'Enact learning run 15',
    steps: [{ id: 'bem', object: 'email_template', action: 'create', name: `${SAMPLE} branded email`, subject: 'Your request $FAULTID has been logged', body: 'Hello,\n\nThanks for your request ($symptom). We\'ll be in touch soon.\n\nThe service desk', brand }],
  }, async (log) => {
    const back = await detail('EmailTemplate', idOf(log, 'bem'));
    const html = String(back?.body_html ?? '');
    const sent = brandedEmail('Hello,\n\nThanks for your request ($symptom). We\'ll be in touch soon.\n\nThe service desk', brand);
    return {
      kept_exactly: html === sent,
      sent_length: sent.length,
      kept_length: html.length,
      kept: { marker: html.includes(BRAND_MARK), logo_img: html.includes('<img'), inline_styles: /style="[^"]*background-color:#1652F0/i.test(html), tables: (html.match(/<table/g) ?? []).length, variables: variablesIn(html) },
      body_html: html.slice(0, 4000),
      design: back?.design,
    };
  });

  // Round 16 (EM4 + EM3 at work): Enact logs a sample ticket on the sample type, filling the type's required fields,
  // moves it to the sample status, then reads every action Halo logged on it.
  const zType = types.find((t) => String(t.name) === `${SAMPLE} request`);
  const users = await list('Users', { count: '50' });
  const requester = users.find((u) => /lewis/i.test(String(u.emailaddress ?? u.name ?? ''))) ?? users.find((u) => String(u.emailaddress ?? '').includes('@'));
  const actionsOf = async (tid: unknown) => extractList(await haloGet('/Actions', { ticket_id: String(tid), excludesys: 'false' }));
  const actionView = (a: Row) => pick(a, /^(id|outcome|who|note|emailto|emailcc|emailfrom|emailsubject|emailtonew|datetime|actionby_agent_id|sendemail|outcome_id|new_status|new_status_name|actisemail|actionarrivaldate|actioncompletiondate)$/i);
  if (zType && zStatus && requester) {
    let tid: unknown = null;
    // Halo names what's mandatory only in its refusal ("Why is this needed? is mandatory"), so fill by label and retry.
    const valueFor = async (fieldId: unknown) => {
      const f = await detail('FieldInfo', fieldId);
      if (!f) return null;
      const t = Number(f.type);
      const first = ((f.values as Row[]) ?? [])[0];
      const value = t === 2 || t === 3 ? first?.id : t === 4 ? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : t === 6 ? true : 'Enact learn round 17';
      return { name: f.name, value, type: t, label: f.label };
    };
    const ticket = (customfields: Row[]) => ({ tickettype_id: zType.id, summary: `${SAMPLE} email check`, details: 'Logged by Enact learn round 17 to check acknowledgement and status emails.', user_id: requester.id, customfields });
    const customfields: Row[] = [];
    for (let attempt = 1; attempt <= 3 && !tid; attempt++) {
      try {
        tid = firstRecord(await haloPost('/Tickets', [ticket(customfields.map(({ name, value }) => ({ name, value })))]))?.id;
      } catch (e) {
        const msg = err(e);
        const labels = [...msg.matchAll(/([^"\\]+?) is mandatory/g)].map((m) => m[1].replace(/^n/, '').trim());
        const found = labels.map((l) => fieldRows.find((r) => String(r.label ?? '').trim().toLowerCase() === l.toLowerCase()));
        note(area, `sample ticket attempt ${attempt}`, { refused: msg, mandatory_labels: labels, matched_fields: found.map((r) => r && { id: r.id, name: r.name, label: r.label }) });
        let added = 0;
        for (const r of found) {
          if (!r || customfields.some((c) => c.name === r.name)) continue;
          const v = await valueFor(r.id);
          if (v) { customfields.push(v); added++; }
        }
        if (!added) break;
      }
    }
    // Where those fields sit on the type's form, so the builder can learn how "mandatory" is marked there.
    const ttd = await detail('TicketType', zType.id);
    const ids = new Set(customfields.map((c) => String(fieldRows.find((r) => r.name === c.name)?.id)));
    note(area, 'mandatory fields on the form', ((ttd?.fields as Row[]) ?? []).filter((r) => ids.has(String(r.fieldid)) || ((r.group as Row)?.fields as Row[] | undefined)?.some((g) => ids.has(String(g.fieldid ?? g.id)))).map((r) => pick(r, /^(id|fieldid|name|seq|endusernew|technew|enduserdetail|techdetail|groupid|group_id|mandatory|fieldinfo)$/)));
    note(area, 'required fields filled', customfields);
    if (tid) {
      const t = await detail('Tickets', tid);
      const u = t?.user_id ? await detail('Users', t.user_id) : null;
      note(area, 'sample ticket', { id: tid, team: t?.team, status_id: t?.status_id, requester: { id: u?.id, name: u?.name, email: u?.emailaddress } });
      summary.push(`· sample ticket ${tid} logged for ${u?.name ?? '?'} (${u?.emailaddress ?? 'no email address'}): check that inbox for "Your request ${tid}: software installed"`);
    }
    // If logging failed, still test the status email on the newest sample ticket of that type.
    const target = tid ?? recent.find((t) => Number(t.tickettype_id) === Number(zType.id) && Number(t.parent_id ?? 0) === 0)?.id;
    if (target) {
      try {
        await new Promise((r) => setTimeout(r, 8000));
        const before = (await actionsOf(target)).map(actionView);
        await haloPost('/Tickets', [{ id: target, status_id: zStatus.id }]);
        await new Promise((r) => setTimeout(r, 10000));
        const after = await actionsOf(target);
        note(area, 'actions after logging', { ticket: target, actions: before });
        note(area, 'actions after moving to the sample status', { ticket: target, status_now: pick(await detail('Tickets', target), /^status/), actions: after.map(actionView) });
        note(area, 'action keys', after[0] ? Object.keys(after[0]) : []);
        summary.push(`· sample ticket ${target}: ${before.length} actions after logging, ${after.length} after the status change`);
        // Halo's background queue: run 17's record (retry_attempts_remaining, system_use, error) came from here.
        const queue: Row = {};
        for (const ep of ['PendingAutomation', 'AutomationQueue', 'BackgroundTask', 'BackgroundTasks', 'ProcessQueue', 'TaskQueue', 'EventQueue', 'Queue', 'IntegratorQueue', 'Pending', 'EmailEvents', 'TicketEvent', 'Events']) {
          try {
            const rows = extractList(await haloGet(`/${ep}`, { ticket_id: String(target), count: '50' }));
            const mine = rows.filter((r) => String(r.ticket_id ?? '') === String(target));
            queue[ep] = { rows: rows.length, for_ticket: mine.map((r) => pick(r, /^(id|timestamp|ticket_id|status|error|system_use|system_use2|execution_type|execute_outcome_id|date_processed)$/)), keys: rows[0] ? Object.keys(rows[0]).slice(0, 25) : [] };
          } catch (e) {
            queue[ep] = err(e).slice(0, 80);
          }
        }
        note(area, 'background queue for the sample ticket', queue);
      } catch (e) {
        note(area, 'status change failed', err(e));
      }
    }
  }
}

// Round 17: where sent emails live. Mailboxes (is outgoing mail set up?) and candidate queue endpoints, read-only.
const mailboxes = await list('Mailbox');
note('requester emails', 'mailboxes', mailboxes.slice(0, 10).map((m) => pick(m, /^(id|name|type|emailaddress|mailbox_type|smtp|outgoing|use|default|enabled|active|from)/i)));
for (const ep of ['EmailQueue', 'OutgoingEmail', 'OutgoingEmails', 'Email', 'EmailLog']) {
  try {
    const rows = extractList(await haloGet(`/${ep}`, { count: '5' }));
    note('requester emails', `endpoint /${ep}`, { rows: rows.length, keys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [], first: rows[0] ? pick(rows[0], /^(id|to|emailto|subject|emailsubject|status|datesent|date|ticket_id|faultid)/i) : null });
  } catch (e) {
    note('requester emails', `endpoint /${ep}`, err(e).slice(0, 160));
  }
}

// 3. What Halo actually sent: the email actions on the most recent sample tickets.
const emailed: Row[] = [];
for (const t of recent.slice(0, 15)) {
  try {
    const acts = extractList(await haloGet('/Actions', { ticket_id: String(t.id), excludesys: 'false' }));
    const mails = acts.filter((a) => /mail/i.test(String(a.outcome ?? a.who ?? '')) || a.emailto || a.emailfrom || Number(a.actionby_application_id ?? 0) === 0 && String(a.note ?? '').toLowerCase().includes('email'));
    if (mails.length) emailed.push({ ticket: t.id, type: typeName.get(Number(t.tickettype_id)), emails: mails.slice(0, 4).map((a) => pick(a, /^(id|outcome|emailto|emailfrom|emailsubject|datetime|who)$/)) });
  } catch (e) {
    emailed.push({ ticket: t.id, error: err(e) });
    break;
  }
}
note('requester emails', 'emails Halo logged on recent tickets', emailed);

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(summary.join('\n'));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.${apply ? '' : '\nRun with -- --apply to make the samples and run the builder on your trial.'}\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
