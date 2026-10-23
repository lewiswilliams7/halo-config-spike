/**
 * Collect everything needed to explain how one ticket behaved (SLA, approval), in one go. Read-only.
 *
 *   npm run diagnose -- 123          (123 = the ticket number)
 *
 * Writes SEND-TO-CLAUDE.txt in the project root. Each read is tried separately: one failing
 * (e.g. an endpoint this instance doesn't have) is recorded and the rest still run.
 */
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INSTANCE_KEY, SPIKE_DIR, extractList, firstRecord, haloGet } from './lib/halo.js';

type Row = Record<string, unknown>;
const ticketId = process.argv[2];
if (!ticketId || !/^\d+$/.test(ticketId)) {
  console.error('Usage: npm run diagnose -- 123   (the ticket number)');
  process.exit(1);
}

const out: Record<string, unknown> = {};
async function grab(label: string, path: string, params: Record<string, string> = {}, list = false): Promise<Row> {
  try {
    const data = await haloGet(path, params);
    const value = list ? extractList(data) : (firstRecord(data) ?? data);
    out[label] = value;
    console.log(`  ✓ ${label}`);
    return (list ? {} : value) as Row;
  } catch (e) {
    out[label] = { error: String((e as Error).message ?? e) };
    console.log(`  ✗ ${label}: ${String((e as Error).message ?? e).slice(0, 120)}`);
    return {};
  }
}
const pick = (r: Row, re: RegExp) => Object.fromEntries(Object.entries(r).filter(([k]) => re.test(k)));

console.log(`\nDiagnosing ticket ${ticketId} on ${INSTANCE_KEY} (read-only)\n`);
const t = await grab('ticket', `/Tickets/${ticketId}`, { includedetails: 'true' });

const user = t.user_id ? await grab('end_user', `/Users/${t.user_id}`, { includedetails: 'true' }) : {};
if (t.client_id) await grab('customer', `/Client/${t.client_id}`, { includedetails: 'true' });
if (t.site_id) await grab('site', `/Site/${t.site_id}`, { includedetails: 'true' });
const tt = t.tickettype_id ? await grab('ticket_type', `/TicketType/${t.tickettype_id}`, { includedetails: 'true' }) : {};

const slaIds = new Set([t.sla_id, tt.default_sla, 3].map(Number).filter((n) => n > 0));
for (const id of slaIds) await grab(`sla_${id}`, `/SLA/${id}`, { includedetails: 'true' });
if (tt.approval_process_id) await grab('approval_process', `/ApprovalProcess/${tt.approval_process_id}`, { includedetails: 'true' });

// Ticket history: approval errors and SLA changes show up as actions.
await grab('ticket_actions', '/Actions', { ticket_id: ticketId, count: '100' }, true);
// Approval records for the ticket (endpoint name not yet proven on this instance; failure is fine).
await grab('ticket_approvals', '/TicketApproval', { ticket_id: ticketId }, true);
// Working hours the SLA runs on.
await grab('workdays', '/Workday', {}, true);

// Quick look at the fields that matter, so the answer is visible straight away.
console.log('\nKey values:');
console.log('  ticket  ', JSON.stringify(pick(t, /sla|priority|tickettype_id|^user_id$|client_id|site_id|approv|status_id|workflow/i)));
console.log('  user    ', JSON.stringify(pick(user, /manager|^id$|^name$|client_id|site_id/i)));
console.log('  type    ', JSON.stringify(pick(tt, /sla|priority|approval_process_id|workflow_id/i)));

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify({ instance: INSTANCE_KEY, diagnose_ticket: ticketId, ...out }, null, 2));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
