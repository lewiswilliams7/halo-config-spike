/** What exists on the connected instance, by name: what a planner needs to reuse real things. Read-only. */
import { extractList, firstRecord, haloGet } from './halo.js';

type Row = Record<string, unknown>;

export async function readInventory() {
  const names = async (resource: string, filter?: (r: Row) => boolean) => {
    const rows = extractList(await haloGet(`/${resource}`));
    return (filter ? rows.filter(filter) : rows).map((r) => String(r.name ?? r.buttonname ?? r.outcome ?? '')).filter(Boolean);
  };
  const workflows = extractList(await haloGet('/Workflow'));
  const workflows_and_their_steps: Record<string, string[]> = {};
  for (const w of workflows) {
    const d = firstRecord(await haloGet(`/Workflow/${w.id}`, { includedetails: 'true' }));
    workflows_and_their_steps[String(w.name)] = ((d?.steps as Row[]) ?? []).map((s) => String(s.name));
  }
  return {
    ticket_types: await names('TicketType'),
    custom_fields: await names('FieldInfo', (r) => Number(r.id) > 0 && String(r.name ?? '').startsWith('CF')),
    field_groups: await names('FieldGroup'),
    workflows_and_their_steps,
    statuses: await names('Status'),
    actions: await names('Outcome'),
    slas: await names('SLA'),
    priorities: await names('Priority'),
    approval_processes: await names('ApprovalProcess'),
    approval_groups: await names('CAB'),
    teams: await names('Team'),
    agents: await names('Agent', (r) => Number(r.id) > 1),
    categories: await names('Category'),
  };
}
