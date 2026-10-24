/**
 * Find which Halo API endpoints exist for the next things we want to build. Read-only: GETs only.
 *
 *   npm run probe
 *
 * For each area it tries the endpoint names Halo commonly uses and reports which answer, how many records
 * they hold and a few names, so translators are built from evidence. Writes SEND-TO-CLAUDE.txt.
 */
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPIKE_DIR, env, extractList, haloGet } from './lib/halo.js';

const AREAS: Record<string, string[]> = {
  'conditional approvals': ['ApprovalProcessRule', 'ApprovalProcessRules', 'ApprovalRule'],
  'email templates': ['EmailTemplate', 'EmailTemplates', 'Template_Email'],
  'notifications and email rules': ['Notification', 'Notifications', 'EmailRule', 'EmailRules', 'Event', 'Events'],
  'ticket rules (routing, priority)': ['TicketRules', 'TicketRule', 'AutomationRule', 'Rules'],
  runbooks: ['Runbook', 'Runbooks', 'IntegrationRunbook', 'IntegrationMethod', 'CustomIntegration'],
  'ticket templates (child tickets)': ['Template', 'TicketTemplate', 'Templates'],
  'field visibility conditions': ['FieldVisibility', 'TicketTypeFieldCondition', 'Condition'],
  'webhooks': ['Webhook', 'Webhooks', 'WebhookEvent'],
  'categories': ['Category'],
  'canned text': ['CannedText'],
};

const label = (r: Record<string, unknown>) => String(r.name ?? r.label ?? r.subject ?? r.title ?? r.description ?? r.id ?? '');
const out: Record<string, unknown> = { instance: env.apiUrl, probed_at: new Date().toISOString(), results: {} };
console.log(`\nProbing ${env.apiUrl} (read-only)\n`);
for (const [area, names] of Object.entries(AREAS)) {
  console.log(area);
  const found: Record<string, unknown> = {};
  for (const n of names) {
    try {
      const data = await haloGet(`/${n}`);
      const rows = extractList(data);
      found[n] = { ok: true, count: rows.length, sample_names: rows.slice(0, 8).map(label), first_record_keys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [], raw_if_not_list: rows.length ? undefined : data };
      console.log(`  ✓ /${n}  ${rows.length} record(s)${rows.length ? `: ${rows.slice(0, 4).map(label).join(', ')}` : ''}`);
    } catch (e) {
      const status = String((e as Error).message).match(/failed \((\d+)\)/)?.[1] ?? 'error';
      found[n] = { ok: false, status };
      console.log(`  · /${n}  ${status}`);
    }
  }
  (out.results as Record<string, unknown>)[area] = found;
}
const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
