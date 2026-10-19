/**
 * The AI planner: plain English in, a reviewed plan out. It never writes to Halo.
 *
 *   npm run plan -- "Create an employee onboarding process with ..."
 *   npm run plan -- --file prompts/enterprise-jml.txt
 *
 * 1. Reads the instance (names of what exists, workflow step names) so the plan reuses real things.
 * 2. Asks the model for a plan in the builder's format, with the builder's limits spelled out:
 *    anything it can't build goes in `unsupported`, choices to check in `assumptions`,
 *    blockers in `questions`. It must never pretend.
 * 3. Validates the plan (known objects, refs defined before use, names exist); on errors,
 *    sends them back once for a fix.
 * 4. Saves it to plans/generated/ and prints a review summary. Build it with:
 *    npm run build:onboarding -- --plan plans/generated/<file>.json
 */
import { readFileSync } from 'node:fs';
import { complete, parseJsonReply } from './lib/llm.js';
import { INSTANCE_KEY, loadJson, saveJson, spikePath, timestamp } from './lib/halo.js';
import { readInventory } from './lib/inventory.js';
import { type Plan, type PlanStep, refsOf } from './lib/translators.js';


// ---------- request ----------
const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const request = fileIdx >= 0 ? readFileSync(spikePath(args[fileIdx + 1]), 'utf8').trim() : args.filter((a) => !a.startsWith('--')).join(' ').trim();
if (!request) {
  console.error('Usage: npm run plan -- "what you want built"   or   npm run plan -- --file prompts/x.txt');
  process.exit(1);
}

// ---------- 1. read the instance ----------
console.log(`\nReading ${INSTANCE_KEY} …`);
const inventory = await readInventory();
const workflowSteps = inventory.workflows_and_their_steps;
const all = new Set(Object.values(inventory).flatMap((v) => (Array.isArray(v) ? v : Object.keys(v))).map((n) => n.toLowerCase()));

// ---------- 2. ask the model ----------
const examples = ['plans/onboarding.json', 'plans/workflow-test.json', 'plans/approval-test-2.json', 'plans/tier1-test-2.json']
  .map((f) => JSON.stringify(loadJson(f)))
  .join('\n\n');

const SYSTEM = `You plan Halo ITSM configuration changes. You output ONE JSON object (no prose) that a deterministic builder executes after a human approves it.

THE BUILDER CAN ONLY DO THIS (anything else is unsupported):
Plan = { "request": string, "steps": Step[], "unsupported": string[], "assumptions": string[], "questions": string[] }
Every step: { "id": unique snake_case, "object": one of below, "action": "create" | "reuse" | "update" }
- reuse: { "match": { "name": exact existing name from the inventory } }. Use for anything that already exists.
- create needs "name". Optional "based_on": exact name of an existing record of the same kind to copy settings from (choose a sensible, plain one; say which in assumptions).
Objects and their create properties:
- field: name "CF"+PascalCase (unique, not in inventory), label, type: text|memo|date|dropdown|checkbox|multiselect, options: string[] (dropdown/multiselect only)
- field_group: name, label (section header), fields: [{ref, mandatory?}]
- team: name, members: [agent step refs]
- agent: REUSE ONLY (people with licences; never create)
- approval_group: name, members: [agent refs], approvals_needed: number
- approval_process: name, approvers: ordered list, each ONE of {"group": ref, "min": n} | {"agent": ref} | {"line_manager": true} | {"adhoc": true}
- sla: name, resolve_days: number (same target for every priority)
- status: name, sla_action: "hold" to pause the SLA while in it (omit otherwise)
- outcome (an action button): name, new_status: status ref (optional)
- workflow: name, copy_of: exact existing workflow name, optional insert_step: { name, after_step: an existing step name of copy_of, enter_via: outcome ref, exits: [{ via: outcome ref, to_step: existing step name }] }. ONE inserted step per workflow, nothing else.
- ticket_type: create: name, based_on, fields: [{ref, mandatory?}], groups: [field_group refs], team: team ref, sla: sla ref, approval: approval_process ref. update: match + set: { workflow?: ref, approval?: ref } (only these two).
Refs are step ids and must be defined by an EARLIER step (reuse or create).

RULES
- Reuse what exists (exact names from the inventory). Never invent agents, teams, workflows or step names that aren't in the inventory unless you create them.
- If the request needs something not listed above (e.g. conditional field visibility, auto-assignment rules, email templates, notifications, child tickets, categories, multiple new workflow steps, different SLA targets per priority, roles/permissions, reports), DO NOT approximate it: describe it plainly in "unsupported" and build only the supported parts.
- Line-manager approval fails for requesters with no line manager set: if you use it, add an assumption saying so.
- If something is ambiguous and a wrong guess would be costly, put it in "questions" and still plan the rest.
- Be concise in names. Output JSON only.

EXAMPLE PLANS (hand-written, proven on a real instance):
${examples}`;

const userMsg = (extra = '') => `INSTANCE INVENTORY (what already exists on this Halo):
${JSON.stringify(inventory)}

REQUEST:
${request}
${extra}`;

// ---------- 3. validate ----------
const OBJECTS = new Set(['team', 'field', 'sla', 'approval_process', 'ticket_type', 'status', 'outcome', 'workflow', 'agent', 'approval_group', 'field_group']);
function validate(plan: Plan): string[] {
  const errors: string[] = [];
  if (!Array.isArray(plan.steps)) return ['"steps" must be an array'];
  const seen = new Set<string>();
  for (const s of plan.steps as PlanStep[]) {
    const where = `step "${s.id}"`;
    if (!s.id) errors.push('a step has no id');
    if (seen.has(s.id)) errors.push(`${where}: duplicate id`);
    if (!OBJECTS.has(s.object)) errors.push(`${where}: unknown object "${s.object}"`);
    if (!['create', 'reuse', 'update'].includes(s.action)) errors.push(`${where}: unknown action "${s.action}"`);
    if (s.action === 'create' && !s.name) errors.push(`${where}: create needs a name`);
    if (s.object === 'agent' && s.action === 'create') errors.push(`${where}: agents can only be reused`);
    if ((s.action === 'reuse' || s.action === 'update') && !all.has(String(s.match?.name ?? '').toLowerCase()))
      errors.push(`${where}: "${s.match?.name}" is not in the inventory`);
    if (s.based_on && !all.has(s.based_on.toLowerCase())) errors.push(`${where}: based_on "${s.based_on}" is not in the inventory`);
    if (s.copy_of && !workflowSteps[s.copy_of]) errors.push(`${where}: copy_of "${s.copy_of}" is not an existing workflow`);
    const inserts = [...(s.insert_steps ?? []), ...(s.insert_step ? [s.insert_step] : [])];
    if (inserts.length && s.copy_of && workflowSteps[s.copy_of]) {
      const stepsOf = workflowSteps[s.copy_of].map((n) => n.toLowerCase());
      for (const ins of inserts) {
        for (const n of [ins.after_step, ...ins.exits.map((e) => e.to_step)])
          if (!stepsOf.includes(String(n).toLowerCase())) errors.push(`${where}: "${n}" is not a step of "${s.copy_of}" (or an earlier inserted step)`);
        stepsOf.push(ins.name.toLowerCase());
      }
    }
    for (const r of refsOf(s)) if (!seen.has(r)) errors.push(`${where}: uses "${r}" before it is defined`);
    seen.add(s.id);
  }
  return errors;
}

let plan: Plan | null = null;
let errors: string[] = [];
for (let attempt = 1; attempt <= 2; attempt++) {
  console.log(attempt === 1 ? 'Planning …' : `Fixing ${errors.length} problem(s) …`);
  const reply = await complete(SYSTEM, userMsg(attempt === 1 ? '' : `\nYOUR PREVIOUS PLAN HAD THESE ERRORS, return a corrected full plan:\n- ${errors.join('\n- ')}\n\nPREVIOUS PLAN:\n${JSON.stringify(plan)}`));
  try {
    plan = parseJsonReply<Plan>(reply);
  } catch {
    errors = ['reply was not valid JSON'];
    continue;
  }
  errors = validate(plan);
  if (!errors.length) break;
}
if (!plan) throw new Error('The model did not return a plan.');

// ---------- 4. save + review ----------
plan.request = request;
const rel = `plans/generated/plan-${timestamp()}.json`;
saveJson(rel, plan);

console.log(`\n${'='.repeat(70)}\nPLAN  (${plan.steps.length} steps)\n${'='.repeat(70)}`);
for (const [i, s] of plan.steps.entries()) {
  const verb = s.action === 'reuse' ? 'reuse ' : s.action === 'update' ? 'update' : 'create';
  const what = s.name ?? s.match?.name ?? '';
  const extra = [s.based_on && `based on "${s.based_on}"`, s.copy_of && `copy of "${s.copy_of}"`, s.type, s.insert_step && `+ step "${s.insert_step.name}"`]
    .filter(Boolean).join(', ');
  console.log(`${String(i + 1).padStart(3)}. ${verb} ${s.object.padEnd(17)} ${what}${extra ? `  (${extra})` : ''}`);
}
const list = (title: string, items?: string[]) => items?.length && console.log(`\n${title}\n${items.map((x) => `  - ${x}`).join('\n')}`);
list('NOT SUPPORTED YET (not built):', plan.unsupported);
list('ASSUMPTIONS (check these):', plan.assumptions);
list('QUESTIONS:', plan.questions);
if (errors.length) console.log(`\n⚠️ Still invalid after a retry, do not build:\n  - ${errors.join('\n  - ')}`);
console.log(`\nSaved ${rel}\nReview it, then dry-run:  npm run build:onboarding -- --plan ${rel}\n`);
