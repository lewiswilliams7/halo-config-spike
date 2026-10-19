/**
 * Create a copy of a fixture through the API: the core spike test.
 *
 *   npm run post -- TicketType fixtures/tickettype-12.json --name "Spike copy"
 *
 * Strips the top-level id so Halo creates a new record instead of updating,
 * renames it, POSTs it, and saves the response to runs/.
 * Then check the new record in the Halo UI and log the result in NOTES.md.
 */
import { firstRecord, haloPost, loadJson, saveJson, timestamp } from './lib/halo.js';

const args = process.argv.slice(2);
const [resource, fixture] = args;
const nameFlag = args.indexOf('--name');
const newName = nameFlag >= 0 ? args[nameFlag + 1] : `Spike copy ${new Date().toLocaleTimeString()}`;

if (!resource || !fixture) {
  console.error('Usage: npm run post -- <Resource> <fixture.json> [--name "New name"]');
  process.exit(1);
}

const payload = structuredClone(loadJson<Record<string, unknown>>(fixture));
delete payload.id;
payload.name = newName;

console.log(`\nPOST /${resource} as "${newName}" (${Object.keys(payload).length} properties)`);
const response = await haloPost(`/${resource}`, [payload]);
const created = firstRecord(response);

const file = saveJson(`runs/post-${resource.toLowerCase()}-${timestamp()}.json`, { sent: payload, response });
console.log(`Created id: ${created?.id ?? '(no id returned)'}`);
console.log(`Saved request + response to ${file}`);
console.log(`Now open it in Halo and record works / partial / blocked in NOTES.md.\n`);
