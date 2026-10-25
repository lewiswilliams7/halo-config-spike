/**
 * Learn how Halo stores the areas behind rule B2, on YOUR TRIAL, and prove the ones switched on. Nothing by hand.
 *
 *   npm run learn              read-only: reads what exists
 *   npm run learn -- --apply   also makes "zz Enact sample ..." records on the trial and runs the real builder
 *
 * Round 25 (25 Oct): actions raise child tickets (Halo's "Change Request" action: child_template_id 9). Read how Halo's
 * own actions do it, give the sample action 107 the same settings pointing at a sample template, then use that
 * action on a sample ticket through the API and see whether a child appears.
 * Round 24 (25 Oct): what raises children other than logging (CT1: at child_template_type 1 nothing does), and where
 * an order between children could live: every action and workflow step read for child / template settings, and
 * Halo's own API schema if the instance serves it. Read-only.
 * Round 23 (25 Oct): round 22 changed three things at once and then no ticket got children. Now: re-read 4049/4050
 * (late children?), read date_dependencies, put sample 46 back to how it was and check children come back, then
 * switch on ONE thing per ticket (child_template_type 1; task dependencies) and see which one holds children back.
 * Round 22 (25 Oct): children in order or after approval. Halo's own templates have none, but every child carries
 * enable_task_dependencies / updateparent_* keys and the parent a child_template_type. On the sample parent 46 only:
 * switch each on, one at a time, and read back what Halo adds; then log a ticket that needs approval and one that
 * doesn't, and see when their children appear.
 * Round 21 (25 Oct): child tickets in order or after approval, read from the templates Halo's own ticket types raise
 * (round 20 listed /Template, which didn't include them). Read-only.
 * Round 20 (25 Oct): the sample approval's stage renamed in words (P9), and how Halo's OWN ticket templates raise child
 * tickets in order or after an approval: every child with creation rules, read in full (read-only).
 * Round 19 (25 Oct): approvals that depend on an answer (P7) at work. The builder makes a sample Yes/No dropdown, a
 * sample IT Security approval group (the API's own agent) and a sample approval process whose only stage is the rule
 * "admin rights = Yes: IT Security approves", and puts both on the sample ticket type. Enact then logs one ticket
 * answering Yes and one answering No, and reads back each ticket's approval state.
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
const out: Record<string, unknown> = { instance: env.apiUrl, learned_at: new Date().toISOString(), round: 25, apply };
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

  // Round 19 (P7 at work): a conditional approval stage, built by the real builder, then two tickets, one each way.
  const zType = types.find((t) => String(t.name) === `${SAMPLE} request`);
  const users = await list('Users', { count: '50' });
  const requester = users.find((u) => /lewis/i.test(String(u.emailaddress ?? u.name ?? ''))) ?? users.find((u) => String(u.emailaddress ?? '').includes('@'));
  const agents = await list('Agent');
  const me = agents.find((a) => Number(a.id) === 3) ?? agents.find((a) => /lewis/i.test(nameOf(a)));
  const ddName = 'CFzzEnactSampleAdminRights';
  if (zType && requester && me) {
    await prove('approval that depends on an answer', {
      request: 'Enact learning run 19',
      steps: [
        { id: 'zt', object: 'ticket_type', action: 'reuse', match: { name: `${SAMPLE} request` } },
        { id: 'me', object: 'agent', action: 'reuse', match: { name: nameOf(me) } },
        { id: 'dd', object: 'field', action: 'create', name: ddName, label: `${SAMPLE} admin rights`, type: 'dropdown', options: ['Yes', 'No'] },
        { id: 'grp', object: 'approval_group', action: 'create', name: `${SAMPLE} IT Security`, members: ['me'], approvals_needed: 1 },
        { id: 'ap', object: 'approval_process', action: 'create', name: `${SAMPLE} conditional approval`, based_on: 'Line Manager Approval Process', approvers: [{ rules: [{ field: 'dd', equals: 'Yes', group: 'grp' }] }] },
        { id: 'form', object: 'ticket_type', action: 'update', match: { name: `${SAMPLE} request` }, set: { add_fields: [{ ref: 'dd' }], approval: 'ap' } },
      ],
    } as Plan, async (log) => {
      const ap = await detail('ApprovalProcess', idOf(log, 'ap'));
      return {
        process: pick(ap, /^(id|name|steps|stages|approvalsteps)$/i),
        rules: extractList(await haloGet('/ApprovalProcessRule', { approvalprocess_id: String(idOf(log, 'ap')) }).catch(() => ({}))).map((r) => pick(r, /^(id|name|approvalprocess_id|step_id|approvalprocess_step_id|criteria|agent_id|group_id|approvers)$/i)),
        ticket_type: pick(await detail('TicketType', zType.id), /approval/i),
      };
    });

    // Round 20 (P9): the same rule as an added stage. The builder recognises the old-named stage and renames it in place.
    await prove('approval stage named in words', {
      request: 'Enact learning run 20',
      steps: [
        { id: 'dd', object: 'field', action: 'reuse', match: { name: ddName } },
        { id: 'grp', object: 'approval_group', action: 'reuse', match: { name: `${SAMPLE} IT Security` } },
        { id: 'ap', object: 'approval_process', action: 'update', match: { name: `${SAMPLE} conditional approval` }, set: { add_stages: [{ rules: [{ field: 'dd', equals: 'Yes', group: 'grp' }] }] } },
      ],
    } as Plan, async (log) => ({ stages: (((await detail('ApprovalProcess', idOf(log, 'ap')))?.steps as Row[]) ?? []).map((r) => pick(r, /^(id|name|sequence|type)$/)) }));

    // Halo names what's mandatory only in its refusal, so fill those by label and retry (run 17).
    const valueFor = async (fieldId: unknown) => {
      const f = await detail('FieldInfo', fieldId);
      if (!f) return null;
      const t = Number(f.type);
      const first = ((f.values as Row[]) ?? [])[0];
      return { name: f.name, value: t === 2 || t === 3 ? first?.id : t === 4 ? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : t === 6 ? true : 'Enact learn round 19' };
    };
    const fields = await list('FieldInfo');
    const dd = await detail('FieldInfo', fields.find((r) => r.name === ddName)?.id);
    const optionId = (n: string) => ((dd?.values as Row[]) ?? []).find((v) => String(v.name) === n)?.id;
    const logTicket = async (answer: string) => {
      const extra: Row[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const cf = [{ name: ddName, value: optionId(answer) }, ...extra];
          return firstRecord(await haloPost('/Tickets', [{ tickettype_id: zType.id, summary: `${SAMPLE} approval check: admin rights ${answer}`, details: 'Logged by Enact learn round 19.', user_id: requester.id, customfields: cf }]))?.id;
        } catch (e) {
          const labels = [...err(e).matchAll(/([^"\\]+?) is mandatory/g)].map((m) => m[1].replace(/^n/, '').trim());
          let added = 0;
          for (const l of labels) {
            const r = fields.find((x) => String(x.label ?? '').trim().toLowerCase() === l.toLowerCase());
            if (!r || extra.some((c) => c.name === r.name)) continue;
            const v = await valueFor(r.id);
            if (v) { extra.push(v); added++; }
          }
          if (!added) throw e;
        }
      }
      return null;
    };
    const approvalView = async (tid: unknown) => {
      const t = await detail('Tickets', tid);
      const acts = extractList(await haloGet('/Actions', { ticket_id: String(tid), excludesys: 'false' }).catch(() => ({})));
      const probe: Row = {};
      for (const ep of ['TicketApproval', 'Approval']) {
        try {
          const rows = extractList(await haloGet(`/${ep}`, { ticket_id: String(tid) }));
          probe[ep] = rows.filter((r) => String(r.ticket_id ?? r.faultid ?? tid) === String(tid)).slice(0, 10).map((r) => pick(r, /^(id|ticket_id|seq|step|step_id|stage|status|result|approved|agent_id|agent_name|group_id|group_name|name|approvalprocess_id|approvalprocess_step_id|datesent|dateresponded|type)$/i));
        } catch (e) {
          probe[ep] = err(e).slice(0, 80);
        }
      }
      return {
        ticket: tid,
        answer: ((t?.customfields as Row[]) ?? []).find((c) => c.name === ddName)?.display,
        status: t?.status_id,
        approval: pick(t, /approv/i),
        actions: acts.map((a) => pick(a, /^(id|outcome|note|new_status_name)$/)),
        approval_records: probe,
      };
    };
    for (const answer of process.argv.includes('--approval-tickets') ? ['Yes', 'No'] : []) {
      try {
        const tid = await logTicket(answer);
        await new Promise((r) => setTimeout(r, 8000));
        const v = await approvalView(tid);
        note('approval experiments', `ticket answering ${answer}`, v);
        summary.push(`· approval check: ticket ${tid} (admin rights ${answer}) status ${v.status}, approval ${JSON.stringify(v.approval).slice(0, 80)}`);
      } catch (e) {
        note('approval experiments', `ticket answering ${answer} failed`, err(e));
      }
    }

    // Round 25: an action that raises a child ticket, Halo's way (actions 37, 31 and 40 on this instance).
    const area25 = 'child ticket from an action';
    try {
      const childKeys = /child|createchild/i;
      const own: Row = {};
      for (const id of [37, 31, 40]) own[id] = pick(await detail('Outcome', id), childKeys);
      const t9 = await detail('Template', (own[37] as Row)?.child_template_id ?? 9);
      note(area25, "Halo's own actions", own);
      note(area25, 'the template action 37 raises', pick(t9, /^(id|name|type|tickettype_id|team|children|child_template_type)$/));
      const sampleAction = (await list('Outcome')).find((o) => nameOf(o) === `${SAMPLE} notify installed`);
      const zzTemplates = (await list('Template')).filter((t) => String(t.name ?? '').startsWith(SAMPLE));
      let raise: Row | null = null;
      for (const t of zzTemplates) {
        const d = await detail('Template', t.id);
        if (Number(d?.type) === Number(t9?.type) && Number(d?.tickettype_id) > 0) { raise = d; break; }
      }
      note(area25, 'sample template to raise', raise ? pick(raise, /^(id|name|type|tickettype_id)$/) : `none of type ${t9?.type}`);
      if (sampleAction && raise) {
        const src = own[37] as Row;
        const body: Row = { id: sampleAction.id, child_template_id: raise.id, child_ticket_type_id: raise.tickettype_id };
        if ('createchildticketortemplate' in src) body.createchildticketortemplate = src.createchildticketortemplate;
        await haloPost('/Outcome', [body]);
        note(area25, 'sample action now', pick(await detail('Outcome', sampleAction.id), childKeys));
        // Use it on a fresh sample ticket, as an agent would.
        const tid = await logTicket('No');
        await new Promise((r) => setTimeout(r, 8000));
        const before = Number((await detail('Tickets', tid))?.child_count ?? 0);
        try {
          await haloPost('/Actions', [{ ticket_id: tid, outcome_id: sampleAction.id, outcome: nameOf(sampleAction), note: 'Enact learn round 25: does this action raise a child?', sendemail: false }]);
        } catch (e) {
          note(area25, 'using the action failed', err(e));
        }
        await new Promise((r) => setTimeout(r, 10000));
        const t = await detail('Tickets', tid);
        const kids = extractList(await haloGet('/Tickets', { parent_id: String(tid), count: '20' }).catch(() => ({}))).filter((k) => Number(k.parent_id) === Number(tid)).map((k) => pick(k, /^(id|summary|tickettype_id|dateoccurred)$/));
        note(area25, 'ticket after the action', { ticket: tid, children_before: before, child_count: t?.child_count, children: kids, actions: extractList(await haloGet('/Actions', { ticket_id: String(tid) }).catch(() => ({}))).map((x) => pick(x, /^(id|outcome|note)$/)) });
        summary.push(`· action raises child: ticket ${tid}, children before ${before}, after ${kids.length}`);
      }
    } catch (e) {
      note(area25, 'failed', err(e));
    }

    // Round 22: children after approval / in order, on sample parent template 46 only.
    const area22 = 'child ticket experiments';
    const parentId = Number((await detail('TicketType', zType.id))?.overridewiththefollowingtemplatewhenloggingmanually ?? 0);
    if (parentId > 0) {
      const flat = (r: Row | null) => Object.fromEntries(Object.entries(r ?? {}).filter(([k, v]) => k !== 'children' && k !== 'customfields' && (typeof v !== 'object' || v === null)));
      const diff = (a: Row, b: Row) => Object.fromEntries(Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => [k, { was: a[k], now: b[k] }]));
      const kidsOf = async () => Promise.all((((await detail('Template', parentId))?.children as Row[]) ?? []).map(async (k) => ({ id: k.id, full: await detail('Template', k.id), row: k })));
      const childrenOf = async (tid: unknown) => extractList(await haloGet('/Tickets', { parent_id: String(tid), count: '20' }).catch(() => ({}))).filter((k) => Number(k.parent_id) === Number(tid)).map((k) => pick(k, /^(id|summary|status_id|dateoccurred)$/));
      // Late children on round 22's tickets?
      for (const tid of [4049, 4050]) note(area22, `round 22 ticket ${tid} now`, { status_id: (await detail('Tickets', tid))?.status_id, children: await childrenOf(tid) });
      const parentNow = await detail('Template', parentId);
      const kidIds = (((parentNow?.children as Row[]) ?? []).map((k) => Number(k.id)));
      note(area22, 'date_dependencies (parent, children)', { parent: parentNow?.date_dependencies, children: await Promise.all(kidIds.map(async (id) => ({ id, date_dependencies: (await detail('Template', id))?.date_dependencies, enable_task_dependencies: (await detail('Template', id))?.enable_task_dependencies }))) });
      const setState = async (parent: Row, child2: Row) => {
        await haloPost('/Template', [{ id: parentId, ...parent }]);
        if (kidIds[1]) await haloPost('/Template', [{ id: kidIds[1], ...child2 }]);
      };
      const trial = async (label: string, parent: Row, child2: Row) => {
        try {
          await setState(parent, child2);
          const tid = await logTicket('No');
          await new Promise((r) => setTimeout(r, 15000));
          const t = await detail('Tickets', tid);
          const kids = await childrenOf(tid);
          note(area22, label, { settings: { parent, child2 }, ticket: tid, status_id: t?.status_id, children: kids });
          summary.push(`· ${label}: ticket ${tid}, ${kids.length} children after 15s`);
        } catch (e) {
          note(area22, `${label} failed`, err(e));
        }
      };
      if (process.argv.includes('--child-trials')) {
      await trial('A: back to how it was', { child_template_type: 0, enable_task_dependencies: false }, { enable_task_dependencies: false });
      await trial('B: child_template_type 1 only', { child_template_type: 1, enable_task_dependencies: false }, { enable_task_dependencies: false });
      await trial('C: task dependencies only (parent and child 2)', { child_template_type: 0, enable_task_dependencies: true }, { enable_task_dependencies: true });
      }
      await setState({ child_template_type: 0, enable_task_dependencies: false }, { enable_task_dependencies: false });
      note(area22, 'sample 46 left as', pick(await detail('Template', parentId), /^(child_template_type|enable_task_dependencies)$/));
    }
  }
}

// Round 24: settings that raise children or link templates, on every action and every workflow step. Read-only.
const childy = /child|template|createticket|create_ticket|spawn|dependen/i;
const nonDefault = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== -1 && v !== false && !(Array.isArray(v) && !v.length);
const actionHits: Row[] = [];
const allActions = await list('Outcome');
for (const a of allActions) {
  const d = await detail('Outcome', a.id);
  const hit = Object.fromEntries(Object.entries(d ?? {}).filter(([k, v]) => childy.test(k) && !/email/i.test(k) && nonDefault(v)));
  if (Object.keys(hit).length) actionHits.push({ action: `${a.id} ${nameOf(a)}`, ...hit });
}
note('child tickets', 'actions with child/template settings', { read: allActions.length, hits: actionHits });
note('child tickets', 'all child/template keys an action has', Object.keys((await detail('Outcome', allActions[0]?.id)) ?? {}).filter((k) => childy.test(k)));
const flowHits: Row[] = [];
for (const w of await list('Workflow')) {
  const d = await detail('Workflow', w.id);
  for (const st of ((d?.steps as Row[]) ?? [])) {
    const hit = Object.fromEntries(Object.entries(st).filter(([k, v]) => childy.test(k) && nonDefault(v)));
    if (Object.keys(hit).length) flowHits.push({ workflow: nameOf(w), step: st.name, ...hit });
  }
  if (flowHits.length > 20) break;
}
note('child tickets', 'workflow steps with child/template settings', flowHits);
for (const path of ['/swagger/v1/swagger.json', '/swagger.json', '/openapi.json']) {
  try {
    const doc = (await haloGet(path)) as Row;
    const schemas = ((doc?.components as Row)?.schemas ?? doc?.definitions ?? {}) as Record<string, Row>;
    const names = Object.keys(schemas).filter((n) => /template|child|dependen/i.test(n)).slice(0, 30);
    note('child tickets', `api schema ${path}`, Object.fromEntries(names.map((n) => [n, Object.keys((schemas[n]?.properties as Row) ?? {}).filter((k) => childy.test(k) || /order|seq|after|wait|approv/i.test(k))])));
    break;
  } catch (e) {
    note('child tickets', `api schema ${path}`, err(e).slice(0, 100));
  }
}

// Round 21: the templates ticket types raise (overridewiththefollowingtemplatewhenloggingmanually), their children in
// full: creation rules, child_template_type, automation, and anything about order or approval. Read-only.
const parentIds = new Set<number>();
const raisedBy = new Map<number, string[]>();
for (const t of types) {
  const d = await detail('TicketType', t.id);
  const tid = Number(d?.overridewiththefollowingtemplatewhenloggingmanually ?? 0);
  if (tid > 0) { parentIds.add(tid); raisedBy.set(tid, [...(raisedBy.get(tid) ?? []), nameOf(t)]); }
}
const childRows: Row[] = [];
for (const pid of parentIds) {
  const d = await detail('Template', pid);
  const kids = (d?.children as Row[]) ?? [];
  const parentView = { id: pid, name: nameOf(d ?? {}), raised_by: raisedBy.get(pid), child_template_type: d?.child_template_type, approval_id: d?.approval_id, children: kids.length };
  const kidViews: Row[] = [];
  for (const k of kids.slice(0, 8)) {
    const kd = await detail('Template', k.id);
    kidViews.push({ id: k.id, name: nameOf(kd ?? {}), child_template_type: kd?.child_template_type, automationtype: kd?.automationtype, rule_count: kd?.rule_count, creation_rules: kd?.creation_rules, other: pick(kd, /seq|order|after|approv|depend|wait|create|parent/i) });
  }
  childRows.push({ parent: parentView, children: kidViews });
}
note('child tickets', 'templates raised by ticket types, with their children', childRows);
summary.push(`· child tickets: ${parentIds.size} parent templates read, ${childRows.reduce((n, r) => n + ((r.children as Row[]).filter((c) => ((c.creation_rules as Row[]) ?? []).length).length), 0)} children with creation rules`);

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
