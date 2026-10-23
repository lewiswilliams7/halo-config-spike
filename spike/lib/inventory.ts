/**
 * What exists on the connected instance: names (for reuse and clash checks) plus the SETTINGS a planner
 * needs to judge "already built / partly built / missing" (rule M2). Read-only, deterministic, no AI.
 *
 * Shapes come from captured records (2026-10-23 bundle):
 *  - TicketType detail: default_team (name), default_sla (id), approval_process_name, workflow_name,
 *    fields[] rows { fieldid, groupid, endusernew, technew, group { name, fields[] { fieldinfo { name } } } }
 *  - FieldInfo detail: label, type, values[] { name }        (fieldinfo-124)
 *  - FieldGroup detail: fields[] { endusernew, technew, fieldinfo { name } }   (fieldgroup-14)
 *  - Status detail: slaaction "hold"                          (status-28)
 *  - CAB detail: members[] { member_name }                     (cab-4)
 *  - ApprovalProcess detail: steps[] { sequence, type, agent_name, cab_name }   (approvalprocess-9)
 *  - SLA detail: priorities[] { name, fixtime, fixunits }      (sla-3)
 * Mandatory = endusernew or technew 3 (rule T2). Field types: SPIKE_MAP.fieldTypes.
 */
import { extractList, firstRecord, haloGet } from './halo.js';

type Row = Record<string, unknown>;

const FIELD_TYPE_NAMES: Record<number, string> = { 0: 'text', 1: 'memo', 2: 'dropdown', 3: 'multiselect', 4: 'date', 6: 'checkbox' };
const APPROVER_TYPES: Record<number, string> = { 10: 'line manager', 1: 'agent', 3: 'group', 8: 'ad-hoc', 42: 'change CAB' };

/** Run fn over items, a few at a time (a few hundred detail reads on a big instance). */
async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>, size = 6): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const nameOf = (r: Row) => String(r.name ?? r.buttonname ?? r.outcome ?? '');
const mandatoryMark = (r: Row) => (Number(r.endusernew) === 3 || Number(r.technew) === 3 ? '*' : '');

export async function readInventory(opts: { detail?: boolean; progress?: (msg: string) => void } = {}) {
  const detail = opts.detail ?? true;
  const say = opts.progress ?? (() => {});
  const list = async (resource: string, filter?: (r: Row) => boolean) => {
    const rows = extractList(await haloGet(`/${resource}`));
    return (filter ? rows.filter(filter) : rows).filter((r) => nameOf(r));
  };
  const get = async (resource: string, id: unknown) => firstRecord(await haloGet(`/${resource}/${id}`, { includedetails: 'true' })) ?? {};

  const ticketTypes = await list('TicketType');
  const fields = await list('FieldInfo', (r) => Number(r.id) > 0 && nameOf(r).startsWith('CF'));
  const fieldGroups = await list('FieldGroup');
  const workflows = await list('Workflow');
  const statuses = await list('Status');
  const slas = await list('SLA');
  const approvalProcesses = await list('ApprovalProcess');
  const cabs = await list('CAB');

  say('workflows');
  const workflows_and_their_steps: Record<string, string[]> = {};
  for (const [w, d] of (await pool(workflows, (w) => get('Workflow', w.id))).map((d, i) => [workflows[i], d] as const))
    workflows_and_their_steps[nameOf(w)] = ((d.steps as Row[]) ?? []).map((s) => String(s.name));

  const inventory = {
    ticket_types: ticketTypes.map(nameOf),
    custom_fields: fields.map(nameOf),
    field_groups: fieldGroups.map(nameOf),
    workflows_and_their_steps,
    statuses: statuses.map(nameOf),
    actions: (await list('Outcome')).map(nameOf),
    slas: slas.map(nameOf),
    priorities: (await list('Priority')).map(nameOf),
    approval_processes: approvalProcesses.map(nameOf),
    approval_groups: cabs.map(nameOf),
    teams: (await list('Team')).map(nameOf),
    agents: (await list('Agent', (r) => Number(r.id) > 1)).map(nameOf),
    categories: (await list('Category')).map(nameOf),
  };
  if (!detail) return { ...inventory, details: undefined };

  const slaName = new Map(slas.map((s) => [Number(s.id), nameOf(s)]));

  say(`${fields.length} custom fields`);
  const fieldDetails = await pool(fields, (f) => get('FieldInfo', f.id));
  const custom_fields: Record<string, string> = {};
  for (const d of fieldDetails) {
    const type = FIELD_TYPE_NAMES[Number(d.type)] ?? `type ${d.type}`;
    const options = ((d.values as Row[]) ?? []).map((v) => String(v.name)).filter(Boolean);
    custom_fields[nameOf(d)] = `"${d.label ?? ''}" ${type}${options.length ? `: ${options.join(' | ')}` : ''}`;
  }

  say(`${ticketTypes.length} ticket types`);
  const ticket_types: Record<string, Row> = {};
  for (const d of await pool(ticketTypes, (t) => get('TicketType', t.id))) {
    const groups: Record<string, string[]> = {};
    const loose: string[] = [];
    for (const row of (d.fields as Row[]) ?? []) {
      const g = row.group as Row | undefined;
      if (Number(row.groupid) > 0 && g) {
        groups[String(g.name)] = ((g.fields as Row[]) ?? []).map((f) => `${(f.fieldinfo as Row)?.name ?? f.fieldid}${mandatoryMark(f)}`);
      } else if (Number(row.fieldid) > 0) {
        loose.push(`${(row.fieldinfo as Row)?.name ?? `field ${row.fieldid}`}${mandatoryMark(row)}`);
      }
    }
    ticket_types[nameOf(d)] = {
      team: d.default_team || undefined,
      sla: slaName.get(Number(d.default_sla)),
      approval: d.approval_process_name || undefined,
      workflow: d.workflow_name || undefined,
      ...(Object.keys(groups).length ? { groups } : {}),
      ...(loose.length ? { fields: loose } : {}),
    };
  }

  say('field groups, statuses, approvals, SLAs');
  const field_groups: Record<string, string[]> = {};
  for (const d of await pool(fieldGroups, (g) => get('FieldGroup', g.id)))
    field_groups[nameOf(d)] = ((d.fields as Row[]) ?? []).map((f) => `${(f.fieldinfo as Row)?.name ?? f.fieldid}${mandatoryMark(f)}`);

  const statuses_that_pause_sla = (await pool(statuses, (s) => get('Status', s.id))).filter((d) => d.slaaction === 'hold').map(nameOf);

  const approval_groups: Record<string, string[]> = {};
  for (const d of await pool(cabs, (c) => get('CAB', c.id))) approval_groups[nameOf(d)] = ((d.members as Row[]) ?? []).map((m) => String(m.member_name));

  const approval_processes: Record<string, string[]> = {};
  for (const d of await pool(approvalProcesses, (a) => get('ApprovalProcess', a.id)))
    approval_processes[nameOf(d)] = ((d.steps as Row[]) ?? [])
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))
      .map((s) => {
        const kind = APPROVER_TYPES[Number(s.type)] ?? `type ${s.type}`;
        const who = Number(s.type) === 3 || Number(s.type) === 42 ? s.cab_name : Number(s.type) === 1 ? s.agent_name : '';
        return who ? `${kind}: ${who}` : kind;
      });

  const sla_targets: Record<string, string> = {};
  for (const d of await pool(slas, (s) => get('SLA', s.id)))
    sla_targets[nameOf(d)] = ((d.priorities as Row[]) ?? []).map((p) => `${p.name} ${p.fixtime}${String(p.fixunits ?? '').toLowerCase()}`).join(', ');

  return {
    ...inventory,
    details: {
      note: 'A * after a field name means mandatory.',
      ticket_types,
      custom_fields,
      field_groups,
      statuses_that_pause_sla,
      approval_groups,
      approval_processes,
      sla_targets,
    },
  };
}
