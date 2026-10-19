/**
 * Template discovery: read the CONNECTED instance and pick a real object of each
 * kind the plan needs, so payloads always start from this customer's own shapes.
 *
 * No hand-copied fixtures, no templates from another instance. Results are cached
 * per instance under fixtures/templates/<host>/ (see halo.ts templateRel).
 *
 * Every pick is read-only (GETs). Selection rules come from the spike's evidence:
 *   - fields: same type as requested, a real custom field (F3); dropdowns need values
 *   - ticket types: prefer a service request type (itilrequesttype 3) like HR Onboarding was
 *   - statuses: a plain custom one, never New/Closed
 *   - outcomes: prefer a non-system action (systemid 0) (O2)
 *   - approval processes: prefer a plain one (types 1/3/10), not a change CAB (type 42)
 *   - workflows: the exact one the plan says to copy (copy_of), by name
 */
import { extractList, fileExists, firstRecord, haloGet, saveJson, templateRel } from './halo.js';
import { type PlanStep, SPIKE_MAP, fieldTemplateFile, workflowTemplateFile } from './translators.js';

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

const lists = new Map<string, Row[]>();
async function list(resource: string): Promise<Row[]> {
  if (!lists.has(resource)) lists.set(resource, extractList(await haloGet(`/${resource}`)));
  return lists.get(resource)!;
}
async function detail(resource: string, id: unknown): Promise<Row | null> {
  return firstRecord(await haloGet(`/${resource}/${id}`, { includedetails: 'true' }));
}
const nameOf = (r: Row) => String(r.name ?? r.buttonname ?? r.outcome ?? '');

/** What templates a set of plan steps needs. */
export function needsFor(steps: PlanStep[]): Need[] {
  const needs = new Map<string, Need>();
  const add = (n: Need) => needs.set(n.file, n);

  for (const s of steps.filter((x) => x.action === 'create')) {
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
          accept: (d) => d.type === code && Number(d.custom) === 1 && (!lookup || (Array.isArray(d.values) && d.values.length > 0)),
          maxDetails: 60,
        });
        break;
      }
      case 'ticket_type':
        add({
          file: 'template-tickettype.json', resource: 'TicketType', why: 'ticket type',
          accept: (d) => Array.isArray(d.fields) && (d.use === undefined || d.use === 'tickets'),
          prefer: (d) => Number(d.itilrequesttype) === 3,
          maxDetails: 25,
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
          listFilter: (r) => !['new', 'closed'].includes(String(r.name ?? '').toLowerCase()),
          accept: (d) => Number(d.type ?? 0) === 0,
        });
        break;
      case 'outcome':
        add({
          file: 'template-outcome.json', resource: 'Outcome', why: 'action',
          accept: () => true, prefer: (d) => Number(d.systemid ?? 0) === 0, maxDetails: 15,
        });
        break;
      case 'workflow':
        add(
          s.copy_of
            ? { file: workflowTemplateFile(s.copy_of), resource: 'Workflow', why: `copy of "${s.copy_of}"`, byName: s.copy_of, force: true }
            : { file: workflowTemplateFile(), resource: 'Workflow', why: 'workflow', accept: (d) => Array.isArray(d.steps) && d.steps.length > 1 },
        );
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
  return [...needs.values()];
}

/** Make sure every template the plan needs exists for this instance. Returns lines describing what was picked. */
export async function ensureTemplates(steps: PlanStep[], opts: { fresh?: boolean } = {}): Promise<string[]> {
  const report: string[] = [];
  for (const need of needsFor(steps)) {
    const rel = templateRel(need.file);
    if (!opts.fresh && !need.force && fileExists(rel)) {
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
    saveJson(rel, picked);
    report.push(`  ${need.why.padEnd(28)} ← ${need.resource} ${picked.id} "${nameOf(picked)}"`);
  }
  return report;
}
