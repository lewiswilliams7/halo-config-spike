/**
 * Read any Halo resource and save it as a fixture.
 *
 *   npm run get -- TicketType          list every ticket type (id + name)
 *   npm run get -- TicketType 12       full detail of one, saved to fixtures/tickettype-12.json
 *   npm run get -- Lookup lookupid=111 any extra key=value args become query parameters
 *
 * Works for Team, Status, Priority, SLA, Field, FieldInfo, FieldGroup,
 * Category, ApprovalProcess, ApprovalProcessRule, TicketType, Workflow, ...
 */
import { extractList, haloGet, saveJson } from './lib/halo.js';

const rawArgs = process.argv.slice(2);
const query = Object.fromEntries(rawArgs.filter((a) => a.includes('=')).map((a) => a.split('=', 2) as [string, string]));
const [resource, id] = rawArgs.filter((a) => !a.includes('='));
if (!resource) {
  console.error('Usage: npm run get -- <Resource> [id]   e.g. npm run get -- TicketType 12');
  process.exit(1);
}

const path = id ? `/${resource}/${id}` : `/${resource}`;
const params: Record<string, string> = { ...(id ? { includedetails: 'true' } : {}), ...query };
const data = await haloGet(path, params);

const suffix = [id, ...Object.entries(query).map(([k, v]) => `${k}${v}`)].filter(Boolean).join('-');
const file = saveJson(`fixtures/${resource.toLowerCase()}${suffix ? `-${suffix}` : ''}.json`, data);
console.log(`\nSaved ${file}`);

if (!id) {
  const rows = extractList(data);
  console.log(`${rows.length} ${resource} record(s):`);
  // Not every resource calls its name `name` (e.g. Outcome). Fall back to the first likely label.
  const label = (row: Record<string, unknown>) =>
    row.name ?? row.label ?? row.buttonname ?? row.outcome ?? row.description ?? row.text ??
    Object.entries(row).find(([k, v]) => typeof v === 'string' && v && !/guid|colour|color|icon/i.test(k))?.[1] ?? '';
  for (const row of rows) console.log(`  ${String(row.id).padStart(5)}  ${label(row)}`);
} else {
  const keys = data && typeof data === 'object' ? Object.keys(data) : [];
  console.log(`${keys.length} properties. Open the file to see the payload shape.`);
}
console.log('');
