/**
 * Capture a record made in Halo's own screens, by NAME (no ids to look up), plus anything linked to it.
 * Read-only. Saves fixtures for `npm run bundle`.
 *
 *   npm run capture -- ApprovalProcess "Over 300 test"
 *   npm run capture -- FieldInfo "Cost band"
 *   npm run capture -- Workflow "Service Request Workflow (with approval)"
 *
 * For an approval process it also tries the ApprovalProcessRule endpoint (where conditional rules may live)
 * with the parameter names Halo commonly uses, and keeps whatever answers.
 */
import { extractList, haloGet, saveJson } from './lib/halo.js';

const [resource, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!resource || !name) {
  console.error('Usage: npm run capture -- ApprovalProcess "Over 300 test"');
  process.exit(1);
}

const label = (r: Record<string, unknown>) => String(r.name ?? r.label ?? r.buttonname ?? r.outcome ?? '');
const rows = extractList(await haloGet(`/${resource}`));
const exact = rows.filter((r) => label(r).toLowerCase() === name.toLowerCase());
const partial = rows.filter((r) => label(r).toLowerCase().includes(name.toLowerCase()));
const hits = exact.length ? exact : partial;
if (!hits.length) {
  console.error(`\nNo ${resource} named "${name}". Names that exist:\n${rows.map((r) => `  ${label(r)}`).join('\n')}\n`);
  process.exit(1);
}
if (hits.length > 1) console.log(`\n${hits.length} matches; capturing all: ${hits.map(label).join(', ')}`);

for (const hit of hits) {
  const detail = await haloGet(`/${resource}/${hit.id}`, { includedetails: 'true' });
  console.log(`\nSaved ${saveJson(`fixtures/${resource.toLowerCase()}-${hit.id}.json`, detail)}  ("${label(hit)}")`);

  if (resource.toLowerCase() === 'approvalprocess') {
    for (const key of ['approvalprocess_id', 'approval_process_id', 'processid', 'process_id']) {
      try {
        const data = await haloGet('/ApprovalProcessRule', { [key]: String(hit.id) });
        const list = extractList(data);
        if (list.length || (data && typeof data === 'object' && Object.keys(data).length)) {
          console.log(`Saved ${saveJson(`fixtures/approvalprocessrule-${key}-${hit.id}.json`, data)}  (${list.length} rule row(s) via ${key})`);
        }
      } catch (e) {
        console.log(`  ApprovalProcessRule?${key}=… : ${String((e as Error).message).split('\n')[0]}`);
      }
    }
  }
}
console.log('\nNow run:  npm run bundle   and attach SEND-TO-CLAUDE.txt\n');
