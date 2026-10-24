/**
 * Deterministic plan checks for rules M5 to M7 (HALO_RULES.md). The model can ignore a prompt rule; it can't get
 * past these. Keep identical to the app's lib/specflow/plan-checks.ts (only the import line differs).
 */
import type { Plan, PlanStep } from './translators.js';

export type CheckContext = {
  /** Custom field name to its inventory details: '"Label" dropdown: a | b'. */
  fieldDetails?: Record<string, string>;
  /** The user's own messages so far, oldest first, including the latest. */
  userMessages?: string[];
  /** Questions asked on earlier turns. The user has replied since, so asking again is a loop. */
  askedBefore?: string[];
};

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
  return errors;
}
