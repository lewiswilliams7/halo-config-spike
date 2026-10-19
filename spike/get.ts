/**
 * Read any Halo resource and save it as a fixture.
 *
 *   npm run get -- TicketType          list every ticket type (id + name)
 *   npm run get -- TicketType 12       full detail of one, saved to fixtures/tickettype-12.json
 *
 * Works for Team, Status, Priority, SLA, Field, FieldInfo, FieldGroup,
 * Category, ApprovalProcess, ApprovalProcessRule, TicketType, Workflow, ...
 */
import { extractList, haloGet, saveJson } from './lib/halo.js';

const [resource, id] = process.argv.slice(2);
if (!resource) {
  console.error('Usage: npm run get -- <Resource> [id]   e.g. npm run get -- TicketType 12');
  process.exit(1);
}

const path = id ? `/${resource}/${id}` : `/${resource}`;
const params: Record<string, string> = id ? { includedetails: 'true' } : {};
const data = await haloGet(path, params);

const file = saveJson(`fixtures/${resource.toLowerCase()}${id ? `-${id}` : ''}.json`, data);
console.log(`\nSaved ${file}`);

if (!id) {
  const rows = extractList(data);
  console.log(`${rows.length} ${resource} record(s):`);
  for (const row of rows) console.log(`  ${String(row.id).padStart(5)}  ${row.name ?? row.label ?? ''}`);
} else {
  const keys = data && typeof data === 'object' ? Object.keys(data) : [];
  console.log(`${keys.length} properties. Open the file to see the payload shape.`);
}
console.log('');
