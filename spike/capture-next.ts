/**
 * Capture the evidence for the areas behind rule B2 (emails, ticket rules, child tickets, section visibility,
 * runbooks) in one go. Read-only: GETs only. Writes SEND-TO-CLAUDE.txt.
 *
 *   npm run capture:next
 *
 * Make the examples first, in Halo's own screens, with names starting "Enact sample" (see the list printed
 * below, or README). For each area it saves those records in full, plus a couple of Halo's own for comparison,
 * and finds ticket types whose sections already have show-when conditions.
 */
import { exec } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPIKE_DIR, env, extractList, firstRecord, haloGet, saveJson } from './lib/halo.js';

type Row = Record<string, unknown>;
const SAMPLE = 'enact sample';
const names = (r: Row) => [r.name, r.label, r.outcome, r.buttonname, r.header_text, r.subject, r.title, r.description].map((v) => String(v ?? ''));
const nameOf = (r: Row) => names(r).find(Boolean) ?? String(r.id);
const isSample = (r: Row) => names(r).some((n) => n.toLowerCase().includes(SAMPLE));

const bundle: Record<string, unknown> = { instance: env.apiUrl, captured_at: new Date().toISOString() };
const found: string[] = [];
const missing: string[] = [];

async function list(resource: string): Promise<Row[] | null> {
  try {
    return extractList(await haloGet(`/${resource}`));
  } catch (e) {
    bundle[`${resource}: list error`] = String((e as Error).message).split('\n')[0];
    return null;
  }
}
async function detail(resource: string, id: unknown): Promise<Row | null> {
  try {
    return firstRecord(await haloGet(`/${resource}/${id}`, { includedetails: 'true' }));
  } catch (e) {
    bundle[`${resource}/${id}: error`] = String((e as Error).message).split('\n')[0];
    return null;
  }
}
async function keep(resource: string, r: Row, why: string) {
  const d = await detail(resource, r.id);
  if (!d) return;
  const key = `${resource.toLowerCase()}-${r.id}.json`;
  bundle[key] = { why, record: d };
  saveJson(`fixtures/next/${key}`, d);
}

/** The sample made by hand, plus a couple of Halo's own records for comparison. */
async function area(resource: string, sampleHint: string, others = 2) {
  const rows = await list(resource);
  if (!rows) return;
  bundle[`${resource}: list (first 3 rows)`] = rows.slice(0, 3);
  const samples = rows.filter(isSample);
  for (const s of samples) await keep(resource, s, 'sample made in Halo');
  (samples.length ? found : missing).push(`${resource}: ${samples.length ? samples.map(nameOf).join(', ') : `no "Enact sample" record (${sampleHint})`}`);
  for (const r of rows.filter((x) => !isSample(x)).slice(0, others)) await keep(resource, r, "Halo's own, for comparison");
}

console.log(`\nCapturing from ${env.apiUrl} (read-only)\n`);
await area('EmailTemplate', 'an email template');
await area('Outcome', 'an action that sends that email template to the end user', 0);
await area('TicketRules', 'a ticket rule on a dropdown answer that sets team and priority');
await area('Template', 'a ticket template with two child tickets');
await area('CustomIntegration', 'a runbook, if you want one');
await area('Webhook', 'optional', 1);
await area('Notification', 'optional', 1);

// Actions that already send an email (any), for comparison with the sample.
const outcomes = (await list('Outcome')) ?? [];
let emailing = 0;
for (const o of outcomes.slice(0, 60)) {
  if (emailing >= 2 || isSample(o)) continue;
  const d = await detail('Outcome', o.id);
  if (d && (d.sendemail === true || Number(d.sendemail) > 0 || Number(d.emailtemplate_id) > 0)) {
    bundle[`outcome-${o.id}.json`] = { why: 'an existing action that sends email', record: d };
    emailing++;
  }
}

// Ticket types: sections with show-when conditions, and anything that points at a ticket template (child tickets).
const types = (await list('TicketType')) ?? [];
let conditional = 0;
const templateLinks: Record<string, Row> = {};
for (const t of types) {
  const d = await detail('TicketType', t.id);
  if (!d) continue;
  const rows = ((d.fields as Row[]) ?? []).filter((r) => {
    const c = r.group_visibility_conditions;
    return (Array.isArray(c) ? c.length : c && c !== '' && c !== '[]') || (r.group_visibility_conditions_value ?? '') !== '';
  });
  if (rows.length && conditional < 3) {
    bundle[`tickettype-${t.id}.json`] = { why: 'has sections with show-when conditions', record: d };
    found.push(`Ticket type with conditional sections: ${nameOf(t)}`);
    conditional++;
  }
  const links = Object.fromEntries(Object.entries(d).filter(([k, v]) => /template/i.test(k) && v !== null && v !== '' && v !== 0 && v !== -1 && !(Array.isArray(v) && !v.length)));
  if (Object.keys(links).length) templateLinks[`${t.id} ${nameOf(t)}`] = links;
  if (isSample(t)) {
    bundle[`tickettype-${t.id}.json`] = { why: 'sample ticket type', record: d };
    found.push(`TicketType: ${nameOf(t)}`);
  }
}
if (!conditional) missing.push('No ticket type has a section with a show-when condition yet');
bundle['ticket types: template settings'] = templateLinks;

const file = resolve(SPIKE_DIR, '..', 'SEND-TO-CLAUDE.txt');
writeFileSync(file, JSON.stringify(bundle, null, 2));
console.log('Found:');
for (const f of found) console.log(`  ✓ ${f}`);
if (missing.length) {
  console.log('\nNot found (make these in Halo, named "Enact sample ...", then run this again):');
  for (const m of missing) console.log(`  · ${m}`);
}
console.log(`\n→ ${file}\nAttach SEND-TO-CLAUDE.txt in the chat.\n`);
if (process.platform === 'win32') exec(`explorer /select,"${file}"`);
