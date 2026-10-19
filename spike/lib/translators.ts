/**
 * Plan step -> Halo API payload. Plain code, no AI.
 *
 * Each translator starts from a TEMPLATE fixture: a real object you built by hand
 * in the Halo UI and saved with `npm run get`. That way the payload shape is
 * Halo's own, and we only override the parts the plan specifies.
 *
 * Anything we don't know yet lives in SPIKE_MAP below as null. Filling those
 * nulls in, by reading your fixtures, IS the spike. While a value is null the
 * builder skips that bit and prints a warning, so you can see exactly what's left.
 */
import { fileExists, loadJson } from './halo.js';

export const SPIKE_MAP = {
  /** Halo's code for each custom field type. Build one field of each type by hand, GET it, read the type value. */
  fieldTypes: {
    text: null,
    memo: null,
    date: null,
    dropdown: null,
    checkbox: null,
  } as Record<string, number | string | null>,

  /** Property names on a Field payload. */
  field: {
    label: null as string | null, //    display label, if separate from `name`
    type: null as string | null, //     property holding the field type code
    options: null as string | null, //  property holding dropdown values (and its shape: see NOTES.md)
  },

  /** Property names on an SLA payload. */
  sla: {
    resolveDays: null as string | null, // or hours/minutes: note the unit in NOTES.md
  },

  /** Property names on an ApprovalProcess payload. */
  approval: {
    requesterManager: null as string | null, // how "requester's line manager" is expressed
  },

  /** Property names on a TicketType payload. */
  ticketType: {
    team: null as string | null, //            default team id
    sla: null as string | null, //             default SLA id
    approvalProcess: null as string | null, // approval process id
    fields: null as string | null, //          array of attached fields
    fieldId: null as string | null, //         inside each entry: the field id property
    fieldMandatory: null as string | null, //  inside each entry: the mandatory flag
  },
};

// ---------- plan types ----------

export type Ids = Record<string, number | string>;

export interface PlanStep {
  id: string;
  object: 'team' | 'field' | 'sla' | 'approval_process' | 'ticket_type';
  action: 'create' | 'reuse';
  name?: string;
  label?: string;
  type?: string;
  options?: string[];
  resolve_days?: number;
  approver?: string;
  match?: { name: string };
  fields?: { ref: string; mandatory?: boolean }[];
  team?: string;
  sla?: string;
  approval?: string;
}

export interface Plan {
  request: string;
  steps: PlanStep[];
}

export interface Translator {
  resource: string;
  template: string; // file in fixtures/
  build: (step: PlanStep, ids: Ids, warn: (msg: string) => void) => Record<string, unknown>;
}

// ---------- helpers ----------

function fromTemplate(file: string, resource: string): Record<string, unknown> {
  if (!fileExists(`fixtures/${file}`)) {
    throw new Error(
      `Missing fixtures/${file}.\n` +
        `  Build one ${resource} by hand in Halo, then run: npm run get -- ${resource} <id>\n` +
        `  and rename the saved file to ${file}.`,
    );
  }
  const copy = structuredClone(loadJson<Record<string, unknown>>(`fixtures/${file}`));
  delete copy.id;
  return copy;
}

function set(payload: Record<string, unknown>, prop: string | null, value: unknown, what: string, warn: (m: string) => void) {
  if (prop) payload[prop] = value;
  else warn(`SPIKE_MAP gap: don't know where "${what}" goes yet; skipped`);
}

// ---------- translators ----------

export const translators: Record<PlanStep['object'], Translator> = {
  team: {
    resource: 'Team',
    template: 'template-team.json',
    build: (step) => {
      const p = fromTemplate('template-team.json', 'Team');
      p.name = step.name;
      return p;
    },
  },

  field: {
    // Ticket custom fields are FieldInfo. /Field is asset fields (see NOTES.md, 2026-10-19).
    resource: 'FieldInfo',
    template: 'template-field.json',
    build: (step, _ids, warn) => {
      const p = fromTemplate('template-field.json', 'FieldInfo');
      p.name = step.name;
      set(p, SPIKE_MAP.field.label, step.label, 'field label', warn);
      const code = step.type ? SPIKE_MAP.fieldTypes[step.type] : null;
      if (code === null || code === undefined) warn(`SPIKE_MAP gap: no type code for "${step.type}"; template's type kept`);
      else set(p, SPIKE_MAP.field.type, code, 'field type', warn);
      if (step.options?.length) set(p, SPIKE_MAP.field.options, step.options, 'dropdown options', warn);
      return p;
    },
  },

  sla: {
    resource: 'SLA',
    template: 'template-sla.json',
    build: (step, _ids, warn) => {
      const p = fromTemplate('template-sla.json', 'SLA');
      p.name = step.name;
      set(p, SPIKE_MAP.sla.resolveDays, step.resolve_days, 'resolve target', warn);
      return p;
    },
  },

  approval_process: {
    resource: 'ApprovalProcess',
    template: 'template-approvalprocess.json',
    build: (step, _ids, warn) => {
      const p = fromTemplate('template-approvalprocess.json', 'ApprovalProcess');
      p.name = step.name;
      if (step.approver === 'requester_manager') {
        set(p, SPIKE_MAP.approval.requesterManager, true, 'requester manager approver', warn);
      }
      return p;
    },
  },

  ticket_type: {
    resource: 'TicketType',
    template: 'template-tickettype.json',
    build: (step, ids, warn) => {
      const p = fromTemplate('template-tickettype.json', 'TicketType');
      const m = SPIKE_MAP.ticketType;
      p.name = step.name;
      if (step.team) set(p, m.team, ids[step.team], 'default team', warn);
      if (step.sla) set(p, m.sla, ids[step.sla], 'default SLA', warn);
      if (step.approval) set(p, m.approvalProcess, ids[step.approval], 'approval process', warn);
      if (step.fields?.length) {
        if (!m.fields || !m.fieldId) {
          warn(`SPIKE_MAP gap: don't know how fields attach to a ticket type yet; skipped`);
        } else {
          p[m.fields] = step.fields.map((f) => ({
            [m.fieldId as string]: ids[f.ref],
            ...(m.fieldMandatory ? { [m.fieldMandatory]: Boolean(f.mandatory) } : {}),
          }));
          if (!m.fieldMandatory && step.fields.some((f) => f.mandatory)) {
            warn(`SPIKE_MAP gap: don't know the mandatory flag yet; fields attached as optional`);
          }
        }
      }
      return p;
    },
  },
};

/** Every id a step points at, so the builder can check order before running. */
export function refsOf(step: PlanStep): string[] {
  return [step.team, step.sla, step.approval, ...(step.fields ?? []).map((f) => f.ref)].filter(
    (r): r is string => Boolean(r),
  );
}
