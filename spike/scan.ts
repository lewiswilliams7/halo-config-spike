/**
 * Read a Halo instance and report what's there, before building anything. Read-only.
 *
 *   npm run scan              profile + pick templates for every supported object type
 *   npm run scan -- --fresh   re-pick templates even if cached
 *
 * This is the "it reads your environment first" step: counts of what exists, which of
 * the instance's own objects the builder will copy shapes from, and data checks that
 * warn about things a plan would trip over (e.g. users without a line manager, rule P4).
 */
import { ensureTemplates } from './lib/discover.js';
import { INSTANCE_KEY, envHalo, extractList, fileTemplates, haloGet } from './lib/halo.js';
import { withRuntime } from './lib/runtime.js';
import type { PlanStep } from './lib/translators.js';

const fresh = process.argv.includes('--fresh');
type Row = Record<string, unknown>;
const count = async (resource: string, filter?: (r: Row) => boolean) => {
  try {
    const rows = extractList(await haloGet(`/${resource}`));
    return filter ? rows.filter(filter).length : rows.length;
  } catch {
    return '?';
  }
};

console.log(`\nScanning ${INSTANCE_KEY} (read-only)\n`);
const profile: [string, unknown][] = [
  ['Ticket types', await count('TicketType')],
  ['Custom fields', await count('FieldInfo', (r) => Number(r.id) > 0 && String(r.name ?? '').startsWith('CF'))],
  ['Field groups', await count('FieldGroup')],
  ['Workflows', await count('Workflow')],
  ['Statuses', await count('Status')],
  ['Actions', await count('Outcome')],
  ['SLAs', await count('SLA')],
  ['Approval processes', await count('ApprovalProcess')],
  ['Approval groups', await count('CAB')],
  ['Teams', await count('Team')],
  ['Agents', await count('Agent')],
];
for (const [k, v] of profile) console.log(`  ${k.padEnd(20)} ${v}`);

// Data check (experimental): users without a line manager break line-manager approvals (P4).
try {
  const users = extractList(await haloGet('/Users', { count: '500' }));
  const key = users.length ? Object.keys(users[0]).find((k) => /manager/i.test(k) && !/is_?manager/i.test(k)) : undefined;
  if (key) {
    const none = users.filter((u) => !u[key] || u[key] === 0 || u[key] === -1).length;
    console.log(`\n  Users without a line manager: ${none} of ${users.length} (via "${key}")`);
    if (none) console.log('  ⚠️ Line-manager approval stages will fail for these users (rule P4).');
  } else {
    console.log('\n  Line-manager check: the user list does not expose a manager field; check not possible yet.');
  }
} catch {
  console.log('\n  Line-manager check: could not read users.');
}

// Pick templates for every object type the builder supports.
const every: PlanStep[] = [
  ...['text', 'memo', 'date', 'dropdown', 'checkbox', 'multiselect'].map(
    (type, i) => ({ id: `f${i}`, object: 'field', action: 'create', type }) as PlanStep,
  ),
  ...(['ticket_type', 'sla', 'approval_process', 'status', 'outcome', 'workflow', 'team', 'approval_group', 'field_group'] as const).map(
    (object) => ({ id: object, object, action: 'create' }) as PlanStep,
  ),
];
console.log(`\nTemplates from this instance${fresh ? ' (fresh)' : ''}:`);
for (const need of every) {
  try {
    console.log((await withRuntime({ halo: envHalo, templates: fileTemplates }, () => ensureTemplates([need], { fresh }))).join('\n'));
  } catch (err) {
    console.log(`  ${need.type ?? need.object}: ❌ ${err instanceof Error ? err.message : err}`);
  }
}
console.log('');
