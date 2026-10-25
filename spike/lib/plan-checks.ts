/**
 * Deterministic plan checks for rules M5 to M7 (HALO_RULES.md). The model can ignore a prompt rule; it can't get
 * past these. Keep identical to the app's lib/specflow/plan-checks.ts (only the import line differs).
 */
import { NON_MOVING_ACTION, SPIKE_MAP, featureReady, featuresOf, refsOf, type Plan, type PlanStep } from './translators.js';
import { brandProblems, variablesIn } from './email-brand.js';

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

  // B2 (2026-10-24): areas still being mapped can't be in a plan, however sure the planner is.
  for (const s of steps) {
    for (const f of featuresOf(s).filter((x) => !featureReady(x)))
      errors.push(`step "${s.id}" uses ${f.name}, which the builder can't do yet. Remove it and describe it in unsupported.`);
  }

  // EM1: a branded email needs a hex colour and an https PNG/JPG logo. EM2: only the $variables Halo's own templates use.
  const known = SPIKE_MAP.emailVariables.known?.map((v) => v.toLowerCase());
  for (const s of steps) {
    if (s.object !== 'email_template') continue;
    for (const p of brandProblems(s.brand)) errors.push(`step "${s.id}": ${p}.`);
    if (!known) continue;
    const text = [s.subject, s.body, s.set?.subject, s.set?.body].filter(Boolean).join(' ');
    const unknown = variablesIn(text).filter((v) => !known.includes(v.toLowerCase()));
    if (unknown.length)
      errors.push(`step "${s.id}": ${unknown.join(', ')} ${unknown.length === 1 ? "isn't a variable" : "aren't variables"} Halo uses. Use one it knows, such as ${Object.keys(SPIKE_MAP.emailVariables.common).join(', ')}.`);
  }

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

  // M12 (2026-10-24): "can't do yet" must not list things the builder now does. (A follow-up kept "conditional
  // approvals aren't supported" and "changing actions on existing stages is not supported" from an older version
  // after P7 and W8 had shipped, so the user was told to set them up by hand.)
  const NOT_SUPPORTED = /\b(not supported|aren['’]t supported|isn['’]t supported|unsupported|can['’]t be built|cannot be built|out of scope|not possible)\b/i;
  const NOW_SUPPORTED: [RegExp, string][] = [
    [/conditional\s+\w*\s*approv|approv\w*\s+only\s+(when|if)/i, 'an approval that depends on a dropdown answer is a rules stage (P7); on an existing approval process, add it as a final stage with set.add_stages (P8)'],
    [/(actions?|buttons?)\s+on\s+existing\s+(workflow\s+)?(stages?|steps?)|retarget/i, 'adding a button to an existing stage or sending an existing button elsewhere is workflow set.add_actions / set.retarget_actions (W8); only REMOVING a button is unsupported'],
  ];
  for (const u of plan.unsupported ?? []) {
    if (!NOT_SUPPORTED.test(u)) continue;
    const hit = NOW_SUPPORTED.find(([re]) => re.test(u));
    if (hit) errors.push(`"can't do yet" says "${u}", but the builder can do this now: ${hit[1]}. Build the supported part and keep only what genuinely can't be built.`);
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

  // A condition on a dropdown's answer (approval rules P7, ticket rules, conditional fields V1): the field must be a
  // dropdown and the answer one of its options.
  const dropdownAnswer = (stepId: string, fieldRef: string, equals: string, what: string) => {
    const f = steps.find((x) => x.id === fieldRef);
    if (!f || f.object !== 'field') { errors.push(`step "${stepId}": ${what}'s field must be a field step (got "${fieldRef}")`); return; }
    const details = ctx.fieldDetails?.[f.match?.name ?? ''];
    const isDropdown = f.action === 'create' ? f.type === 'dropdown' : / dropdown/.test(details ?? '');
    if (!isDropdown) { errors.push(`step "${stepId}": ${what} can only test a dropdown; "${f.label ?? fieldLabel(details) ?? f.match?.name}" isn't one`); return; }
    const added = steps.filter((x) => x.object === 'field' && x.action === 'update' && x.match?.name === f.match?.name).flatMap((x) => x.set?.add_options ?? []);
    const options = f.action === 'create' ? f.options ?? [] : [...existingOptions(details), ...added];
    if (!options.some((o) => o.trim().toLowerCase() === String(equals ?? '').trim().toLowerCase()))
      errors.push(`step "${stepId}": "${f.label ?? fieldLabel(details) ?? f.match?.name}" has no option "${equals}" (it has ${options.join(', ') || 'none'})`);
  };

  // P7 (2026-10-24): an approval rule tests a dropdown's answer and names who approves.
  for (const s of steps) {
    if (s.object !== 'approval_process') continue;
    for (const a of [...(s.approvers ?? []), ...(s.set?.add_stages ?? [])]) {
      if (!('rules' in a)) continue;
      if (!a.rules?.length) errors.push(`step "${s.id}": a rules stage needs at least one rule`);
      for (const r of a.rules ?? []) {
        if (!r.group && !r.agent) errors.push(`step "${s.id}": the rule for "${r.equals}" doesn't say who approves (group or agent)`);
        dropdownAnswer(s.id, r.field, r.equals, 'an approval rule');
      }
    }
  }

  // Ticket rules: conditions on the ticket type or a dropdown answer, and something to set. Without a ticket type
  // condition a rule runs on EVERY ticket type, so that must be on purpose.
  for (const s of steps) {
    if (s.object !== 'ticket_rule') continue;
    if (s.action === 'update') {
      if (s.set?.priority === undefined) errors.push(`step "${s.id}": updating a ticket rule can only change its priority (set.priority)`);
      else if (!(Number.isInteger(Number(s.set.priority)) && Number(s.set.priority) >= 1)) errors.push(`step "${s.id}": set.priority must be a priority LEVEL number (got "${s.set.priority}")`);
      continue;
    }
    if (s.action !== 'create') continue;
    if (!s.when?.length) errors.push(`step "${s.id}": a ticket rule needs conditions in "when", or it matches every ticket`);
    for (const c of s.when ?? []) {
      if ('ticket_type' in c) {
        if (steps.find((x) => x.id === c.ticket_type)?.object !== 'ticket_type') errors.push(`step "${s.id}": when.ticket_type must be a ticket_type step (got "${c.ticket_type}")`);
      } else if ('impact' in c || 'urgency' in c) {
        const v = String('impact' in c ? c.impact : c.urgency);
        if (!/^(high|medium|low)$/i.test(v)) errors.push(`step "${s.id}": impact/urgency must be High, Medium or Low (got "${v}")`);
      } else dropdownAnswer(s.id, c.field, c.equals, 'a ticket rule condition');
    }
    if (s.then?.category && steps.find((x) => x.id === s.then?.category)?.object !== 'category') errors.push(`step "${s.id}": then.category must be a category step`);
    if (s.action === 'create' && !s.then?.team && !s.then?.agent && s.then?.priority === undefined && !s.then?.category) errors.push(`step "${s.id}": the ticket rule doesn't set anything (then.team, then.agent, then.priority)`);
    if (s.then?.priority !== undefined && !(Number.isInteger(Number(s.then.priority)) && Number(s.then.priority) >= 1))
      errors.push(`step "${s.id}": then.priority must be a priority LEVEL number from inventory.details.priority_levels (got "${s.then.priority}")`);
  }

  // N1: a notification needs a known event and agents to tell.
  for (const s of steps) {
    if (s.object !== 'notification' || s.action !== 'create') continue;
    if (!s.event) errors.push(`step "${s.id}": a notification needs an event`);
    if (!s.agents?.length && !s.team) errors.push(`step "${s.id}": a notification needs a team (or agents) to tell`);
    if (s.team && steps.find((x) => x.id === s.team)?.object !== 'team') errors.push(`step "${s.id}": "${s.team}" isn't a team step`);
    if (!s.when?.length) errors.push(`step "${s.id}": scope the notification with when (at least the ticket type), or it fires for every ticket (N3)`);
    for (const c of s.when ?? []) if ('field' in c) dropdownAnswer(s.id, c.field, c.equals, 'a notification condition');
    for (const a of s.agents ?? []) if (steps.find((x) => x.id === a)?.object !== 'agent') errors.push(`step "${s.id}": "${a}" isn't an agent step`);
  }
  // K1: a category is a path of up to four levels.
  for (const s of steps) {
    if (s.object !== 'category' || s.action !== 'create') continue;
    const levels = String(s.name ?? '').split('>').map((x) => x.trim()).filter(Boolean);
    if (!levels.length || levels.length > 4) errors.push(`step "${s.id}": a category name is a path like "Hardware>Laptop>Repair" (1 to 4 levels)`);
  }

  // C1: child tickets hang off one ticket type and are each raised as a ticket of some type.
  for (const s of steps) {
    if (s.object !== 'ticket_template') continue;
    if (steps.find((x) => x.id === s.attach_to)?.object !== 'ticket_type') errors.push(`step "${s.id}": attach_to must be a ticket_type step (got "${s.attach_to}")`);
    if (!s.children?.length) errors.push(`step "${s.id}": a ticket template needs at least one child ticket`);
    for (const c of s.children ?? []) {
      if (!c.summary?.trim()) errors.push(`step "${s.id}": every child ticket needs a summary`);
      if (steps.find((x) => x.id === c.ticket_type)?.object !== 'ticket_type') errors.push(`step "${s.id}": child "${c.summary}" needs ticket_type: a ticket_type step (got "${c.ticket_type}")`);
      if (c.team && steps.find((x) => x.id === c.team)?.object !== 'team') errors.push(`step "${s.id}": child "${c.summary}" team must be a team step`);
    }
  }

  // EM4: an acknowledgement email is an email template, set on a ticket type.
  for (const s of steps) {
    const ack = s.set?.acknowledgement_email;
    if (!ack) continue;
    if (s.object !== 'ticket_type') errors.push(`step "${s.id}": acknowledgement_email only works on a ticket type`);
    if (steps.find((x) => x.id === ack)?.object !== 'email_template') errors.push(`step "${s.id}": acknowledgement_email must be an email_template step (got "${ack}")`);
  }

  // V1: a conditional field tests a dropdown's answer; the field and the dropdown must be on that form.
  for (const s of steps) {
    for (const c of s.set?.show_field_when ?? []) {
      if (s.object !== 'ticket_type') { errors.push(`step "${s.id}": show_field_when only works on a ticket type`); continue; }
      if (c.field === c.when) errors.push(`step "${s.id}": a field can't depend on its own answer`);
      dropdownAnswer(s.id, c.when, c.equals, 'show_field_when');
    }
  }

  // M11 (2026-10-24): on a follow-up, anything dropped from the plan must be named in the reply. (A follow-up about
  // approvals silently dropped a field, a button and a workflow change while saying "everything else is unchanged".)
  if (ctx.previousSteps) {
    const key = (x: PlanStep) => `${x.object}:${String(x.name ?? x.match?.name ?? '').toLowerCase()}:${x.action}`;
    const now = new Set(steps.map(key));
    const reply = String(plan.reply ?? '').toLowerCase();
    const dropped = ctx.previousSteps.filter((p) => p.action !== 'reuse' && !now.has(key(p)));
    const droppedIds = new Set(dropped.map((p) => p.id));
    // The reply may name the step, or say it removed that kind of thing ("removed the steps that created a new
    // approval process"). A step that only pointed at another dropped step goes with it (attaching that approval).
    const DROP_VERB = /\b(remov|drop|delet|no longer|instead|replac|undo|undid|scrap|took out|taken out)/;
    const saysDropped = (object: string) => DROP_VERB.test(reply) && reply.includes(object.replace(/_/g, ' '));
    for (const p of dropped) {
      if (refsOf(p).some((r) => droppedIds.has(r))) continue;
      const shown = String(p.label ?? p.name ?? p.match?.name ?? '');
      const label = fieldLabel(ctx.fieldDetails?.[p.match?.name ?? '']) ?? shown;
      if (![shown, label].some((n) => n && reply.includes(n.toLowerCase())) && !saysDropped(p.object))
        errors.push(`the follow-up drops "${label}" (${p.object}) from the plan without saying so. Keep it, or if the user asked for it to go, name it in reply.`);
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
