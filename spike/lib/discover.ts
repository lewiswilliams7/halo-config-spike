/**
 * Template discovery: read the CONNECTED instance and pick a real object of each
 * kind the plan needs, so payloads always start from this customer's own shapes.
 *
 * No hand-copied fixtures, no templates from another instance. Results are cached
 * per instance by the caller's template store (the spike: files per host; the app: memory, per build).
 *
 * Every pick is read-only (GETs). Selection rules come from the spike's evidence:
 *   - fields: same type as requested, a real custom field (F3); dropdowns need values
 *   - ticket types: prefer a service request type (itilrequesttype 3) like HR Onboarding was
 *   - statuses: a plain custom one, never New/Closed
 *   - outcomes: prefer a non-system action (systemid 0) (O2)
 *   - approval processes: prefer a plain one (types 1/3/10), not a change CAB (type 42)
 *   - workflows: the exact one the plan says to copy (copy_of), by name
 */
import { extractList, firstRecord, runtime } from './runtime.js';
import { type PlanStep, SPIKE_MAP, fieldTemplateFile, namedTemplate, templateFileFor, workflowTemplateFile } from './translators.js';

type Row = Record<string, unknown>;

interface Need {
  file: string;
  resource: string;
  why: string;
  force?: boolean; //                  always re-fetch (e.g. a named workflow)
  byName?: string; //                  pick this exact record
  listFilter?: (r: Row) => boolean; //  cheap filter on list rows
  accept?: (d: Row) => boolean; //      must hold on the full record
  prefer?: (d: Row) => boolean; //      take the first that also matches this, if any
  maxDetails?: number;
}

async function list(resource: string): Promise<Row[]> {
  const { lists, halo } = runtime(); // cached for this build only
  if (!lists.has(resource)) lists.set(resource, extractList(await halo.get(`/${resource}`)));
  return lists.get(resource)!;
}
async function detail(resource: string, id: unknown): Promise<Row | null> {
  return firstRecord(await runtime().halo.get(`/${resource}/${id}`, { includedetails: 'true' }));
}
const nameOf = (r: Row) => String(r.name ?? r.buttonname ?? r.outcome ?? '');

/** What templates a set of plan steps needs. */
export function needsFor(steps: PlanStep[]): Need[] {
  const needs = new Map<string, Need>();
  const add = (n: Need) => needs.set(n.file, n);

  for (const s of steps.filter((x) => x.action === 'create' && !namedTemplate(x))) {
    switch (s.object) {
      case 'field': {
        const type = s.type ?? 'text';
        const code = SPIKE_MAP.fieldTypes[type];
        const lookup = type === 'dropdown' || type === 'multiselect';
        add({
          file: fieldTemplateFile(type),
          resource: 'FieldInfo',
          why: `${type} field`,
          listFilter: (r) => Number(r.id) > 0 && String(r.name ?? '').startsWith('CF') && (r.type === undefined || r.type === code),
          // Lookups must be a field's OWN static list (extratype 1). A field fed by a built-in list
          // (e.g. regions) ignores the values we send and shows its own (rule D2, 2026-10-19).
          accept: (d) =>
            d.type === code && Number(d.custom) === 1 &&
            (!lookup || (Number(d.extratype) === 1 && Array.isArray(d.values) && d.values.length > 0)),
          maxDetails: 60,
        });
        break;
      }
      case 'ticket_type':
        add({
          file: 'template-tickettype.json', resource: 'TicketType', why: 'ticket type',
          accept: (d) => Array.isArray(d.fields) && (d.use === undefined || d.use === 'tickets'),
          // A plain service request type: not a booking, project, task, article or chat type.
          prefer: (d) =>
            Number(d.itilrequesttype) === 3 &&
            !/booking|project|task|article|feedback|teams|placeholder|major|problem|change/i.test(String(d.name)) &&
            !Number(d.agentresourcebookingtype ?? 0),
          maxDetails: 40,
        });
        break;
      case 'sla':
        add({ file: 'template-sla.json', resource: 'SLA', why: 'SLA', accept: (d) => Array.isArray(d.priorities) && d.priorities.length > 0 });
        break;
      case 'approval_process':
        add({
          file: 'template-approvalprocess.json', resource: 'ApprovalProcess', why: 'approval process',
          accept: (d) => Array.isArray(d.steps) && d.steps.length > 0,
          // Prefer a plain process (line manager / agent / group), not a change CAB with change-only statuses.
          prefer: (d) => (d.steps as Row[]).every((st) => [1, 3, 10].includes(Number(st.type))),
        });
        break;
      case 'status':
        add({
          file: 'template-status.json', resource: 'Status', why: 'status',
          // Not a status Halo treats specially.
          listFilter: (r) =>
            !['new', 'closed', 'draft', 're-opened', 'updated', 'in progress', 'invoiced', 'rejected', 'approved',
              'awaiting approval', 'cancelled', 'resolved'].includes(String(r.name ?? '').toLowerCase()),
          accept: (d) => Number(d.type ?? 0) === 0,
        });
        break;
      case 'outcome':
        add({
          file: 'template-outcome.json', resource: 'Outcome', why: 'action',
          // A plain action: not a system one, doesn't change status, and not one that closes/approves/etc.
          accept: (d) => !/resolve|close|re-?open|approv|cancel|delete|merge|escalat/i.test(nameOf(d)),
          prefer: (d) => Number(d.systemid ?? 0) === 0 && Number(d.newstatus ?? 0) === 0,
          maxDetails: 25,
        });
        break;
      case 'workflow':
        if (!s.copy_of) add({ file: workflowTemplateFile(), resource: 'Workflow', why: 'workflow', accept: (d) => Array.isArray(d.steps) && d.steps.length > 1 });
        break;
      case 'team':
        add({ file: 'template-team.json', resource: 'Team', why: 'team', accept: () => true });
        break;
      case 'approval_group':
        add({ file: 'template-cab.json', resource: 'CAB', why: 'approval group', accept: () => true });
        break;
      case 'field_group':
        add({ file: 'template-fieldgroup.json', resource: 'FieldGroup', why: 'field group', accept: (d) => Array.isArray(d.fields) });
        break;
    }
  }
  // Plans can name the record to copy (based_on / copy_of): that always wins (rule D3).
  for (const s of steps.filter((x) => x.action === 'create' && namedTemplate(x))) {
    const named = namedTemplate(s)!;
    const file = templateFileFor(s, '');
    needs.set(file, { file, resource: RESOURCE_OF[s.object], why: `${s.object} based on "${named}"`, byName: named, force: true });
  }
  return [...needs.values()];
}

const RESOURCE_OF: Record<PlanStep['object'], string> = {
  field: 'FieldInfo', ticket_type: 'TicketType', sla: 'SLA', approval_process: 'ApprovalProcess', status: 'Status',
  outcome: 'Outcome', workflow: 'Workflow', team: 'Team', approval_group: 'CAB', field_group: 'FieldGroup',
  agent: 'Agent',
};

/** Make sure every template the plan needs exists for this instance. Returns lines describing what was picked. */
export async function ensureTemplates(steps: PlanStep[], opts: { fresh?: boolean } = {}): Promise<string[]> {
  const report: string[] = [];
  for (const need of needsFor(steps)) {
    const { templates } = runtime();
    if (!opts.fresh && !need.force && templates.has(need.file)) {
      report.push(`  ${need.why.padEnd(28)} cached`);
      continue;
    }

    let rows = await list(need.resource);
    let picked: Row | null = null;

    if (need.byName) {
      const want = need.byName.toLowerCase();
      const row = rows.find((r) => nameOf(r).toLowerCase() === want);
      if (!row) throw new Error(`Discovery: this instance has no ${need.resource} named "${need.byName}" to copy.`);
      picked = await detail(need.resource, row.id);
    } else {
      if (need.listFilter) rows = rows.filter(need.listFilter);
      let fallback: Row | null = null;
      for (const row of rows.slice(0, need.maxDetails ?? 10)) {
        const d = await detail(need.resource, row.id);
        if (!d || (need.accept && !need.accept(d))) continue;
        if (!need.prefer || need.prefer(d)) { picked = d; break; }
        fallback ??= d;
      }
      picked ??= fallback;
    }

    if (!picked) throw new Error(`Discovery: couldn't find a usable ${need.why} on this instance to copy the shape from.`);
    templates.set(need.file, picked);
    report.push(`  ${need.why.padEnd(28)} ← ${need.resource} ${picked.id} "${nameOf(picked)}"`);
  }
  return report;
}
