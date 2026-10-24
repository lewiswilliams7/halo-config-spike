/**
 * Deterministic plan checks for rules M5 to M7 (HALO_RULES.md). The model can ignore a prompt rule; it can't get
 * past these. Keep identical to the app's lib/specflow/plan-checks.ts (only the import line differs).
 */
import { NON_MOVING_ACTION, type Plan, type PlanStep } from './translators.js';

export type CheckContext = {
  /** Custom field name to its inventory details: '"Label" dropdown: a | b'. */
  fieldDetails?: Record<string, string>;
  /** The user's own messages so far, oldest first, including the latest. */
  userMessages?: string[];
  /** Questions asked on earlier turns. The user has replied since, so asking again is a loop. */
  askedBefore?: string[];
  /** Fields that are mandatory everywhere they appear on the instance (marked * in the inventory). */
  alwaysMandatory?: Set<string>;
  /** The previous version's steps, on a follow-up (rule M8). */
  previousSteps?: PlanStep[];
};

/** Field names marked * (mandatory) in every form or section they appear in. */
export function mandatoryEverywhere(lists: string[][]): Set<string> {
  const seen = new Map<string, boolean>();
  for (const list of lists)
    for (const raw of list) {
      const name = String(raw).replace(/\*$/, '');
      const star = String(raw).endsWith('*');
      seen.set(name, (seen.get(name) ?? true) && star);
    }
  return new Set([...seen].filter(([, all]) => all).map(([n]) => n));
}

/** "Under £300", "£300 or more", "Over 10 users": a band on a number. */
export function isBand(option: string): boolean {
  if (!/\d/.test(option)) return false;
  return /[£$€]\s?\d/.test(option) || /\d\s?\+|\b(or more|or less|or over|or under|and over|and under|over|under|above|below|more than|less than|up to|between)\b|[<>≤≥]/i.test(option);
}

/** A band with something else mixed in: "Laptop (£300 or more)". One question per field. */
export function mixedBand(option: string): boolean {
  if (!isBand(option)) return false;
  const rest = option
    .replace(/[£$€]\s?[\d,.]+k?/gi, ' ')
    .replace(/\b\d[\d,.]*\s?(k|users?|days?|hours?|people|items?|devices?)?\b/gi, ' ')
    .replace(/\b(or|more|less|and|over|under|above|below|than|up|to|between|cost|costs|costing|value|price|spend|total)\b/gi, ' ')
    .replace(/[^a-z]+/gi, ' ')
    .trim();
  return rest.length > 0;
}

/** Options already on an existing custom field, from its inventory details ('"Label" dropdown: a | b'). */
function existingOptions(details?: string): string[] {
  const m = details?.match(/^"[^"]*"\s+[^:]+:\s*(.*)$/);
  return m ? m[1].split(' | ').map((o) => o.trim()).filter(Boolean) : [];
}
const fieldLabel = (details?: string) => details?.match(/^"([^"]*)"/)?.[1];

const STOP = new Set('a an the and or of to for on in is are be it this that you your we do does should would will can with as at by from if any which what who how there their them its than then also want like'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9£ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const CONDITIONAL_APPROVAL = /approv/i;
const CONDITION = /\b(only|if|when|unless|condition|conditional|depend|depends|based on|value|threshold|over|under|above|below)\b|[£$€]\s?\d/i;
const EVERY_TICKET_APPROVED = /\b(every|all)\s+(\S+\s+){0,4}tickets?\b[^.]*\bapprov/i;

export function planChecks(plan: Plan, ctx: CheckContext = {}): string[] {
  const errors: string[] = [];
  const steps = (plan.steps ?? []) as PlanStep[];
  const nameOf = (ref?: string) => {
    const s = steps.find((x) => x.id === ref);
    return s?.name ?? s?.match?.name ?? ref ?? '';
  };

  // M5: a threshold is its own two-option field; never fold it into another field's options.
  for (const s of steps) {
    if (s.object !== 'field') continue;
    const where = `step "${s.id}"`;
    if (s.action === 'update') {
      const details = ctx.fieldDetails?.[s.match?.name ?? ''];
      const current = existingOptions(details);
      const currentAreBands = current.length > 0 && current.every((o) => isBand(o) && !mixedBand(o));
      const banded = (s.set?.add_options ?? []).filter(isBand);
      if (banded.length && !currentAreBands)
        errors.push(`${where}: adds "${banded[0]}" to the existing field "${fieldLabel(details) ?? s.match?.name}". A threshold is its own question: create a new dropdown field with just the bands (for example "Under £300" and "£300 or more"), put it on the form, and leave this field's options alone.`);
    }
    if (s.action === 'create') {
      const mixed = (s.options ?? []).filter(mixedBand);
      if (mixed.length)
        errors.push(`${where}: option "${mixed[0]}" mixes a threshold into another answer. Keep one question per field: a separate dropdown with just the bands (for example "Under £300" and "£300 or more").`);
    }
  }

  // M6: an approval that should depend on a condition we can't build must not be attached to every ticket.
  const conditional = (plan.unsupported ?? []).find((u) => CONDITIONAL_APPROVAL.test(u) && CONDITION.test(u));
  const everyTicketMeant = (plan.assumptions ?? []).some((a) => EVERY_TICKET_APPROVED.test(a));
  if (conditional && !everyTicketMeant) {
    for (const s of steps) {
      if (s.object !== 'ticket_type') continue;
      const approval = s.action === 'create' ? s.approval : s.set?.approval;
      if (approval)
        errors.push(`step "${s.id}": attaches "${nameOf(approval)}" to the ticket type, so EVERY ticket goes for approval, but the approval should depend on a condition that can't be built yet ("${conditional}"). Leave the approval off the ticket type. Only if some approval must happen on every ticket regardless, keep it and add an assumption starting "Every ticket of this type is approved by ...".`);
    }
  }

  // W6/W7 (2026-10-24): every new stage needs a way out, through a button that actually moves the ticket.
  // ("Pre-checks" left via Re-Assign only, which opens the reassign box: tickets were stuck there.)
  for (const s of steps) {
    if (s.object !== 'workflow') continue;
    for (const ins of [...(s.insert_steps ?? []), ...(s.insert_step ? [s.insert_step] : []), ...(s.set?.insert_steps ?? [])]) {
      if (!ins.exits?.length) errors.push(`step "${s.id}": the new stage "${ins.name}" has no way out. Give it at least one exit (a button and the stage it leads to, e.g. Closed).`);
      for (const e of ins.exits ?? []) {
        const via = nameOf(e.via);
        if (NON_MOVING_ACTION.test(via)) errors.push(`step "${s.id}": "${ins.name}" exits via "${via}", which doesn't move a ticket on (it opens a dialog). Use a plain action, e.g. a new one named for what happens next.`);
      }
    }
    for (const c of s.set?.add_actions ?? []) {
      const via = nameOf(c.via);
      if (NON_MOVING_ACTION.test(via)) errors.push(`step "${s.id}": the new button "${via}" on "${c.step}" doesn't move a ticket on (it opens a dialog). Use a plain or closing action.`);
    }
  }

  // P7 (2026-10-24): an approval rule tests a dropdown's answer. The field must be a dropdown and the answer one of
  // its options, and the rule must name who approves.
  for (const s of steps) {
    if (s.object !== 'approval_process') continue;
    for (const a of s.approvers ?? []) {
      if (!('rules' in a)) continue;
      if (!a.rules?.length) errors.push(`step "${s.id}": a rules stage needs at least one rule`);
      for (const r of a.rules ?? []) {
        const f = steps.find((x) => x.id === r.field);
        if (!f || f.object !== 'field') { errors.push(`step "${s.id}": an approval rule's "field" must be a field step (got "${r.field}")`); continue; }
        if (!r.group && !r.agent) errors.push(`step "${s.id}": the rule for "${r.equals}" doesn't say who approves (group or agent)`);
        const details = ctx.fieldDetails?.[f.match?.name ?? ''];
        const isDropdown = f.action === 'create' ? f.type === 'dropdown' : / dropdown/.test(details ?? '');
        if (!isDropdown) { errors.push(`step "${s.id}": approval rules can only test a dropdown; "${f.label ?? fieldLabel(details) ?? f.match?.name}" isn't one`); continue; }
        const added = steps.filter((x) => x.object === 'field' && x.action === 'update' && x.match?.name === f.match?.name).flatMap((x) => x.set?.add_options ?? []);
        const options = f.action === 'create' ? f.options ?? [] : [...existingOptions(details), ...added];
        if (!options.some((o) => o.trim().toLowerCase() === r.equals.trim().toLowerCase()))
          errors.push(`step "${s.id}": "${f.label ?? fieldLabel(details) ?? f.match?.name}" has no option "${r.equals}" (it has ${options.join(', ') || 'none'})`);
      }
    }
  }

  // M7: questions must be worth asking.
  const qs = plan.questions ?? [];
  const followUp = (ctx.userMessages?.length ?? 0) > 1;
  if (followUp && qs.length > 2) errors.push(`${qs.length} questions on a follow-up: ask at most 2, only ones that change what gets built. Decide the rest and record the choice in assumptions.`);
  for (const q of qs) {
    const again = (ctx.askedBefore ?? []).find((b) => overlap(q, b) >= 0.6);
    if (again)
      errors.push(`question "${q}" was already asked ("${again}") and the user has replied since. Use their reply. If they left it to you ("either", "up to you", "don't mind"), decide, and say what you chose in assumptions.`);
    const quoted = [...q.matchAll(/["“‘']([^"”’']{3,80})["”’']/g)].map((m) => m[1].toLowerCase());
    const theirs = quoted.find((x) => (ctx.userMessages ?? []).some((u) => u.toLowerCase().includes(x)));
    if (theirs && /\b(acceptable|ok|okay|confirm|happy|fine|correct|different name|would you like|is that right)\b/i.test(q))
      errors.push(`question "${q}" asks the user to confirm "${theirs}", which they wrote themselves. Use it as given.`);
    if (/\bCF[A-Za-z0-9_]+/.test(q)) errors.push(`question "${q}" uses an internal field name; use the field's label.`);
  }
  if (plan.reply && /\bCF[A-Za-z0-9_]+/.test(plan.reply)) errors.push('"reply" uses an internal field name; use the field\'s label.');

  // M7: don't ask whether to make a field mandatory when it already is everywhere it appears.
  for (const q of qs) {
    if (!/\b(mandatory|required|compulsory)\b/i.test(q)) continue;
    for (const name of ctx.alwaysMandatory ?? []) {
      const label = fieldLabel(ctx.fieldDetails?.[name]);
      if ((label && q.toLowerCase().includes(label.toLowerCase())) || q.includes(name))
        errors.push(`question "${q}" asks about making "${label ?? name}" mandatory, but it is already mandatory everywhere it appears. Don't ask; reuse it as it is.`);
    }
  }

  // M8: on a follow-up, the reply must not claim a change the plan doesn't make.
  if (ctx.previousSteps && plan.reply) {
    const key = (xs: PlanStep[]) => JSON.stringify([...xs].sort((a, b) => a.id.localeCompare(b.id)));
    const unchanged = key(ctx.previousSteps) === key(steps);
    const claims = /\b(i['’]ll|i will|i['’]ve|i have|now|will)\b[^.]*\b(add|adding|make|making|set|setting|change|changing|switch|move|remove|drop|create|rename|update|put|mark)\b/i;
    const denies = /\b(nothing|no change|no changes|unchanged|won['’]t change|not chang|no need)\b/i.test(plan.reply);
    if (unchanged && !denies && claims.test(plan.reply))
      errors.push(`"reply" says "${plan.reply}", but the plan's steps are unchanged. Make that change in upsert_steps (for example field_mandatory on the form or section that holds the field), or if it can't be done, say so plainly in reply and keep the plan as it is.`);
  }
  return errors;
}
