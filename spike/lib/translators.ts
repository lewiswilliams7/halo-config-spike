/**
 * Plan step -> Halo API payload. Plain code, no AI.
 *
 * Each translator starts from a TEMPLATE fixture (a real object captured with
 * `npm run get`), deep-cleaned by cleanForCreate so no nested id can touch an
 * existing record, then overrides only what the plan specifies.
 *
 * SPIKE_MAP holds what we've learned about Halo's payloads. Every value says where
 * the evidence came from. `null` = still unknown: the builder skips it and warns.
 * Values marked INFERRED are best guesses from evidence: confirm in the UI (NOTES.md).
 */
import { cleanForCreate } from './clean.js';
import { fileExists, loadJson, templateRel } from './halo.js';

export const SPIKE_MAP = {
  /** FieldInfo.type. Evidence: fieldinfo-141 (text=0), -114 (memo=1), -124 (dropdown=2),
   *  CFperipherals/CFsoftware (multi-select=3), -153 (date=4), -193 (checkbox=6). */
  fieldTypes: {
    text: 0,
    memo: 1,
    dropdown: 2,
    multiselect: 3,
    date: 4,
    checkbox: 6,
  } as Record<string, number | null>,

  field: {
    label: 'label' as string | null, //   evidence: fieldinfo-141 label "First Name"
    type: 'type' as string | null,
    /** Dropdown values: existing fields use values: [{ name }] tied to a lookup table.
     *  INFERRED that posting values without a lookup id creates a new list. Test with post. */
    options: 'values' as string | null,
  },

  sla: {
    /** Targets are per priority: priorities[].fixtime + fixunits ('H' | 'D'). Evidence: sla-3. */
    priorities: 'priorities' as string | null,
    fixTime: 'fixtime' as string | null,
    fixUnits: 'fixunits' as string | null,
  },

  approval: {
    /** steps[].type. Evidence: approval processes 1,2,3,4,7,8 (NOTES.md 2026-10-19). */
    steps: 'steps' as string | null,
    lineManagerStepType: 10 as number | null,
    agentStepType: 1,
    groupStepType: 3,
    adhocStepType: 8,
    approverIdKey: 'agent_id_or_cab_id',
    minApproversKey: 'minapprovers',
  },

  ticketType: {
    /** Evidence: tickettype-36. default_team takes the team NAME ("Human Resources"), not an id. */
    teamName: 'default_team' as string | null,
    sla: 'default_sla' as string | null, //                  id
    approvalProcess: 'approval_process_id' as string | null, // id
    summary: 'default_summary' as string | null,
    fields: 'fields' as string | null,
    fieldId: 'fieldid' as string | null,
    /** INFERRED from tickettype-36: endusernew/technew = 3 on what look like required fields, 1 otherwise. */
    mandatoryKeys: ['endusernew', 'technew'] as string[] | null,
    mandatoryValue: 3,
    optionalValue: 1,
  },
};

function departmentOf(ref: string, refs: Refs, warn: (m: string) => void): Record<string, unknown> {
  const row = refs[ref]?.row;
  if (row?.department_id === undefined) {
    warn(`department_of: "${ref}" has no department to copy (reuse a team for it)`);
    return {};
  }
  return { department_id: row.department_id };
}

type Row = Record<string, unknown>;

/** Existing rows of a field list, ready to send back: nested display objects dropped (rule U2). */
function keepRows(rows: unknown): Row[] {
  return ((rows as Row[]) ?? []).map((r) => {
    const { group: _g, fieldinfo: _f, ...rest } = r;
    return rest;
  });
}

/** Add fields / change mandatory on a list of field rows (ticket type or field group). */
/** Rough "same field" test on labels: lower-case words with simple endings removed ("Starting Date" ~ "Start date"). */
function sameMeaning(a: string, b: string): boolean {
  const stem = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w.replace(/(ing|ed|s)$/, '')).join(' ');
  return stem(a) === stem(b);
}

/** Every label shown on a form: loose fields and fields inside its sections (from the detail read). */
function formLabels(current: Row): string[] {
  const out: string[] = [];
  for (const r of (current.fields as Row[]) ?? []) {
    const fi = r.fieldinfo as Row | undefined;
    if (fi?.label) out.push(String(fi.label));
    for (const f of ((r.group as Row)?.fields as Row[]) ?? []) if ((f.fieldinfo as Row)?.label) out.push(String((f.fieldinfo as Row).label));
  }
  return out;
}

function editFieldRows(rows: Row[], refs: Refs, add: { ref: string; mandatory?: boolean }[] = [], mand: { ref: string; mandatory: boolean }[] = [], shape: Row, warn: (m: string) => void, labelsOnForm: string[] = []): Row[] {
  const m = SPIKE_MAP.ticketType;
  const level = (b?: boolean) => (b ? m.mandatoryValue : m.optionalValue);
  for (const c of mand) {
    const row = rows.find((r) => Number(r.fieldid) === Number(refs[c.ref]?.id));
    if (!row) { warn(`field_mandatory: ${c.ref} isn't on this form; add it with add_fields`); continue; }
    for (const k of m.mandatoryKeys ?? []) row[k] = level(c.mandatory);
  }
  let seq = Math.max(0, ...rows.map((r) => Number(r.seq) || 0));
  for (const f of add) {
    const id = Number(refs[f.ref]?.id);
    if (rows.some((r) => Number(r.fieldid) === id)) { warn(`add_fields: ${f.ref} is already on this form`); continue; }
    // Rule F8 (2026-10-23): "Start date" added to a form that already had "Starting Date" in a section.
    const label = String(refs[f.ref]?.row?.label ?? '');
    const twin = label ? labelsOnForm.find((l) => sameMeaning(l, label)) : undefined;
    if (twin) warn(`add_fields: the form already has a field labelled "${twin}"; "${label}" may be a duplicate`);
    const row: Row = { ...shape, fieldid: id, seq: ++seq };
    for (const k of m.mandatoryKeys ?? []) row[k] = level(f.mandatory);
    rows.push(row);
  }
  return rows;
}

/** Problems if the read-back rows don't carry the fields / mandatory levels we sent. */
function checkFieldRows(back: unknown, sent: unknown, what: string): string[] {
  const m = SPIKE_MAP.ticketType;
  const got = (back as Row[]) ?? [];
  const out: string[] = [];
  for (const r of (sent as Row[]) ?? []) {
    const key = Number(r.fieldid) !== 0 ? 'fieldid' : 'groupid';
    const b = got.find((g) => Number(g[key]) === Number(r[key]) && (key === 'groupid' ? Number(g.fieldid) === 0 : true));
    if (!b) { out.push(`${what}: ${key} ${r[key]} not on the form after saving`); continue; }
    for (const k of m.mandatoryKeys ?? []) if (r[k] !== undefined && Number(b[k]) !== Number(r[k])) out.push(`${what}: ${key} ${r[key]} ${k} is ${b[k]}, wanted ${r[k]}`);
  }
  return out;
}

/** Insert new stages into a workflow payload (new copy OR an existing workflow). Local ids only (rule W1/W2). */
function applyInserts(p: Row, inserts: InsertStep[], refs: Refs): Row {
  const steps = p.steps as Row[];
  const stages = p.stages as Row[];
  const byName = (n: string) => steps.find((s) => String(s.name).toLowerCase() === n.toLowerCase());
  for (const ins of inserts) {
    const after = byName(ins.after_step);
    if (!after) throw new Error(`Workflow has no step named "${ins.after_step}"`);
    if (byName(ins.name)) throw new Error(`Workflow already has a step named "${ins.name}"`);
    const newStepId = Math.max(...steps.map((s) => Number(s.step_id))) + 1;
    const newStage = Number(after.stage_number) + 1;

    // Make room in the progress bar: shift later stages (and the steps on them) along by one.
    for (const st of stages) if (Number(st.sequence) >= newStage) st.sequence = Number(st.sequence) + 1;
    for (const s of steps) if (Number(s.stage_number) >= newStage) s.stage_number = Number(s.stage_number) + 1;
    stages.push({ sequence: newStage, name: ins.name, edit_outcome: -1, type: 1 });
    stages.sort((a, b) => Number(a.sequence) - Number(b.sequence));

    // Action rows copy the shape of an existing outcome action on the "after" step (ids of that row dropped).
    const actions = (after.actions as Row[]) ?? [];
    const { id: _id, guid: _guid, ...shape } = actions.find((a) => Number(a.action_type) === 1) ?? actions[0] ?? {};
    const action = (via: string, from: number, to: number, seq: number): Row => ({
      ...shape,
      action_type: 1,
      action_id: refs[via]?.id,
      action_name: refs[via]?.name ?? '',
      action_outcome: '',
      start_step: from,
      end_step: to,
      seq,
      approval_result: -1,
      conditions: [],
      conditions_exec: [],
      group_restrictions: [],
    });

    // Into the new step: an extra action on the "after" step.
    actions.push(action(ins.enter_via, Number(after.step_id), newStepId, actions.length + 1));
    after.actions = actions;

    // The new step itself, shaped like the "after" step, with its own exit actions.
    const { id: _sid, guid: _sguid, ...afterShape } = after;
    const newStep: Row = { ...afterShape, name: ins.name, step_id: newStepId, stage_number: newStage, isstart: false, isend: false, islaststep: false, actions: [] };
    steps.push(newStep);
    newStep.actions = ins.exits.map((e, i) => {
      const target = byName(e.to_step);
      if (!target) throw new Error(`Workflow has no step named "${e.to_step}"`);
      return action(e.via, newStepId, Number(target.step_id), i + 1);
    });
  }
  // Designer boxes for new steps are added by Halo itself (proven 2026-10-19: designer showed Awaiting Equipment).
  return p;
}

// ---------- plan types ----------

export interface Ref {
  id: number | string;
  name?: string;
  /** Full record of a reused object (detail read), so later steps can copy settings from it. */
  row?: Record<string, unknown>;
}
export type Refs = Record<string, Ref>;

export interface PlanStep {
  id: string;
  object: 'team' | 'field' | 'sla' | 'approval_process' | 'ticket_type' | 'status' | 'outcome' | 'workflow' | 'agent' | 'approval_group' | 'field_group';
  action: 'create' | 'reuse' | 'update';
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
  /** status: SLA behaviour while in this status, e.g. 'hold'. Omit to keep the template's. */
  sla_action?: string;
  colour?: string;
  /** outcome (action): ref of the status the ticket moves to. */
  new_status?: string;
  /** workflow: insert one new step after an existing one. */
  insert_step?: InsertStep;
  /** workflow: insert several steps, in order; later ones may come after earlier inserted ones. */
  insert_steps?: InsertStep[];
  /** sla: per-priority resolve targets by priority name, e.g. { "Critical": "4h", "Low": "5d" }. */
  targets?: Record<string, string>;
  /** team / approval_group: agent refs. */
  members?: string[];
  /** approval_group: how many members must approve. */
  approvals_needed?: number;
  /** ticket_type: field group refs, added after the plain fields. */
  groups?: string[];
  /** workflow: name of an existing workflow on THIS instance to copy. */
  copy_of?: string;
  /** any create: name of an existing record on THIS instance to copy the shape from (rule D3). */
  based_on?: string;
  /** approval_process: approval stages in order. Each stage is ONE of these (rule P1). */
  approvers?: Approver[];
  /** update: properties to change on an existing record, as refs (e.g. { workflow: "wf" }). */
  set?: {
    // ticket_type
    workflow?: string;
    approval?: string;
    team?: string;
    sla?: string;
    add_groups?: string[];
    add_fields?: { ref: string; mandatory?: boolean }[];
    // ticket_type (its own loose fields) and field_group: change mandatory on fields already there
    field_mandatory?: { ref: string; mandatory: boolean }[];
    // team
    department_of?: string;
    // status
    sla_action?: string;
    // workflow: add stages to an EXISTING workflow in place (rule W3)
    insert_steps?: InsertStep[];
    // field: add dropdown/multi-select options, change the label
    add_options?: string[];
    label?: string;
    // approval_group / team
    add_members?: string[];
  };
  /** team: put the team in the same department as this reused team (step ref). Rule T3. */
  department_of?: string;
  /** outcome: Font Awesome icon name for the action button (default arrow-right). Rule O3. */
  icon?: string;
}

export interface InsertStep {
  name: string;
  after_step: string; //                         existing (or earlier inserted) step name
  enter_via: string; //                          outcome ref: action on after_step that moves into the new step
  exits: { via: string; to_step: string }[]; //  outcome refs: actions on the new step, to step names
}

export type Approver =
  | { line_manager: true } //                 type 10
  | { agent: string } //                      type 1, ref to an agent step
  | { group: string; min?: number } //        type 3, ref to an approval_group step
  | { adhoc: true }; //                       type 8, agent picks at the time

export interface Plan {
  request: string;
  steps: PlanStep[];
  /** Planner output: parts of the request the builder can't do yet, in plain words. */
  /** What the instance already has for each part of the request, so the plan only builds the gap. */
  existing_coverage?: { requirement: string; status: 'built' | 'partial' | 'missing'; existing?: string }[];
  unsupported?: string[];
  /** Planner output: choices it made that the user should check (e.g. which template it based things on). */
  assumptions?: string[];
  /** Planner output: things it needs answered before the plan is safe to build. */
  questions?: string[];
}

export interface Translator {
  resource: string;
  template: string; // file in fixtures/
  /** The name Halo will actually store, if it differs from what we send. Used to find and verify. */
  storedName?: (step: PlanStep) => string;
  /** A real follow-up update to send straight after creating. Some objects only finish setting up on their first save. */
  afterCreate?: (id: number) => Record<string, unknown>;
  /** Property holding the record's name, if not `name` (e.g. Outcome uses `outcome`). */
  nameKey?: string;
  /** For action 'update': the partial payload (without id) to send. `current` = the record's detail read. */
  update?: (step: PlanStep, refs: Refs, warn: (msg: string) => void, current: Record<string, unknown>) => Record<string, unknown>;
  /** For action 'update': check the read-back. Returns problems; without it, scalar keys are compared. */
  verifyUpdate?: (back: Record<string, unknown>, changes: Record<string, unknown>, step: PlanStep, refs: Refs) => string[];
  build: (step: PlanStep, refs: Refs, warn: (msg: string) => void) => Record<string, unknown>;
}

// ---------- helpers ----------

function fromTemplate(file: string, resource: string): Record<string, unknown> {
  // Templates come from the connected instance itself (lib/discover.ts), stored per instance.
  const rel = templateRel(file);
  if (!fileExists(rel)) {
    throw new Error(`No ${resource} template for this instance (${rel}). Discovery should have found one; run npm run scan.`);
  }
  return cleanForCreate(loadJson<Record<string, unknown>>(rel));
}

/** Template file for a field of a given plan type ("text", "dropdown", ...). */
export function fieldTemplateFile(type = 'text'): string {
  return `template-field-${type}.json`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Template file for "copy this named workflow". */
export function workflowTemplateFile(copyOf?: string): string {
  return copyOf ? `template-workflow--${slug(copyOf)}.json` : 'template-workflow.json';
}

/** The record a step should copy its shape from, if the plan names one (based_on, or copy_of for workflows). */
export function namedTemplate(step: PlanStep): string | undefined {
  return step.based_on ?? (step.object === 'workflow' ? step.copy_of : undefined);
}

/** Which template file a step uses: a named one if the plan says "based_on", else the default for its kind. */
export function templateFileFor(step: PlanStep, fallback: string): string {
  const named = namedTemplate(step);
  return named ? `template-${step.object}--${slug(named)}.json` : fallback;
}

export const FIELD_SUMMARY_PLACEHOLDER = 'created by builder';

/** "CFOnboardStartDate" → "OnboardStartDate". Halo adds the CF back. */
export function bareFieldName(name = ''): string {
  return name.replace(/^CF/i, '');
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
    build: (step, refs, warn) => {
      // Evidence: team-6. Members are agents[] rows { agent_id }; the template's members are dropped.
      const p = fromTemplate(templateFileFor(step, 'template-team.json'), 'Team');
      p.name = step.name;
      p.agents = (step.members ?? []).map((m) => ({ agent_id: refs[m]?.id }));
      p.managers = [];
      // Rule T3 (2026-10-19): a team's department comes from whatever template it was copied from
      // (People Operations landed in "IT" via 1st Line Support). Take it from a named team instead.
      if (step.department_of) Object.assign(p, departmentOf(step.department_of, refs, warn));
      return p;
    },
    update: (step, refs, warn, current) => {
      const out: Record<string, unknown> = {};
      if (step.set?.department_of) Object.assign(out, departmentOf(step.set.department_of, refs, warn));
      if (step.set?.add_members?.length) {
        // Evidence: team-12 agents[] rows { agent_id, ... }. Existing rows sent back as they are.
        const agents = ((current.agents as Row[]) ?? []).map((a) => ({ ...a }));
        for (const m of step.set.add_members) {
          const id = Number(refs[m]?.id);
          if (agents.some((a) => Number(a.agent_id) === id)) { warn(`add_members: ${m} is already in the team`); continue; }
          agents.push({ agent_id: id });
        }
        out.agents = agents;
      }
      if (!Object.keys(out).length) warn('update: nothing to set');
      return out;
    },
    verifyUpdate: (back, changes) => {
      const out: string[] = [];
      if (changes.department_id !== undefined && Number(back.department_id) !== Number(changes.department_id)) out.push(`department is ${back.department_id}`);
      if (changes.agents) {
        const ids = ((back.agents as Row[]) ?? []).map((a) => Number(a.agent_id));
        for (const a of changes.agents as Row[]) if (!ids.includes(Number(a.agent_id))) out.push(`agent ${a.agent_id} not in the team after saving`);
      }
      return out;
    },
  },

  field: {
    // Ticket custom fields are FieldInfo. /Field is asset fields (NOTES.md, 2026-10-19).
    resource: 'FieldInfo',
    template: 'template-field-<type>.json',
    // Halo prefixes custom field names with "CF" itself: sending "CFx" stores "CFCFx" (2026-10-19, field 310).
    storedName: (step) => `CF${bareFieldName(step.name)}`,
    // Rule F6 (2026-10-19): a field created via the API only works fully (dropdown options show)
    // after one real save. Create with a placeholder summary, then clear it: a real change, clean result.
    afterCreate: (id) => ({ id, summary: '' }),
    build: (step, _refs, warn) => {
      // Prefer a template of the same field type: each type carries its own defaults.
      // A text template made dropdowns with inputtype -1 and no load_type, and their options didn't show (2026-10-19).
      const p = fromTemplate(templateFileFor(step, fieldTemplateFile(step.type)), 'FieldInfo');
      const m = SPIKE_MAP.field;
      p.name = bareFieldName(step.name);
      set(p, m.label, step.label, 'field label', warn);
      p.hint = '';
      p.summary = FIELD_SUMMARY_PLACEHOLDER; // cleared by afterCreate (rule F6)
      p.defaultvalue = '';
      delete p.defaultvalue_lookup; // e.g. "Standard Laptop" from the dropdown template

      const code = step.type ? SPIKE_MAP.fieldTypes[step.type] : null;
      if (code === null || code === undefined) warn(`SPIKE_MAP gap: no type code for "${step.type}"; template's type kept`);
      else set(p, m.type, code, 'field type', warn);

      if (step.options?.length) {
        set(p, m.options, step.options.map((name) => ({ name })), 'dropdown options', warn);
      } else if (m.options) {
        delete p[m.options];
      }
      return p;
    },
    update: (step, _refs, warn, current) => {
      const m = SPIKE_MAP.field;
      const st = step.set ?? {};
      const out: Record<string, unknown> = {};
      if (st.label && m.label) out[m.label] = st.label;
      if (st.add_options?.length && m.options) {
        // Existing values keep their ids; new ones go on the end as { name } (same shape as on create).
        const values = ((current[m.options] as Row[]) ?? []).map((v) => ({ ...v }));
        for (const name of st.add_options) {
          if (values.some((v) => String(v.name).toLowerCase() === name.toLowerCase())) { warn(`add_options: "${name}" is already an option`); continue; }
          values.push({ name });
        }
        out[m.options] = values;
      }
      if (!Object.keys(out).length) warn('update: nothing to set');
      return out;
    },
    verifyUpdate: (back, changes) => {
      const m = SPIKE_MAP.field;
      const out: string[] = [];
      if (m.label && changes[m.label] !== undefined && back[m.label] !== changes[m.label]) out.push(`label is ${JSON.stringify(back[m.label])}`);
      if (m.options && changes[m.options]) {
        const have = ((back[m.options] as Row[]) ?? []).map((v) => String(v.name).toLowerCase());
        for (const v of changes[m.options] as Row[]) if (!have.includes(String(v.name).toLowerCase())) out.push(`option "${v.name}" missing after saving`);
      }
      return out;
    },
  },

  sla: {
    resource: 'SLA',
    template: 'template-sla.json',
    build: (step, _refs, warn) => {
      const p = fromTemplate(templateFileFor(step, 'template-sla.json'), 'SLA');
      const m = SPIKE_MAP.sla;
      p.name = step.name;
      if (step.targets) {
        const rows = m.priorities ? (p[m.priorities] as Record<string, unknown>[] | undefined) : undefined;
        for (const [prio, target] of Object.entries(step.targets)) {
          const row = rows?.find((r) => String(r.name).toLowerCase() === prio.toLowerCase());
          const t = String(target).match(/^(\d+(?:\.\d+)?)\s*([hd])$/i);
          if (!row || !t || !m.fixTime || !m.fixUnits) {
            warn(`SLA target "${prio}: ${target}" skipped (unknown priority or format; use e.g. "4h" or "5d")`);
            continue;
          }
          row[m.fixTime] = Number(t[1]);
          row[m.fixUnits] = t[2].toUpperCase();
        }
      } else if (step.resolve_days !== undefined) {
        const rows = m.priorities ? (p[m.priorities] as Record<string, unknown>[] | undefined) : undefined;
        if (!rows || !m.fixTime || !m.fixUnits) {
          warn(`SPIKE_MAP gap: don't know how to set the resolve target yet; skipped`);
        } else {
          // Same target for every priority. A real plan could vary it per priority.
          for (const row of rows) {
            row[m.fixTime] = step.resolve_days;
            row[m.fixUnits] = 'D';
          }
        }
      }
      return p;
    },
  },

  approval_process: {
    resource: 'ApprovalProcess',
    template: 'template-approvalprocess.json',
    build: (step, refs, warn) => {
      const p = fromTemplate(templateFileFor(step, 'template-approvalprocess.json'), 'ApprovalProcess');
      const m = SPIKE_MAP.approval;
      p.name = step.name;
      const approvers: Approver[] =
        step.approvers ?? (step.approver === 'requester_manager' ? [{ line_manager: true }] : []);
      if (!approvers.length) return p;

      const steps = m.steps ? (p[m.steps] as Record<string, unknown>[] | undefined) : undefined;
      if (!steps?.length) {
        warn(`Approval template has no steps to copy the shape from; approvers skipped`);
        return p;
      }
      const shape = steps[0];
      p[m.steps as string] = approvers.map((a, i) => {
        // Rule P3: agent_name/cab_name are display labels Halo fills from the id; never copy them.
        const row: Record<string, unknown> = { ...shape, sequence: i + 1, name: '', agent_name: '', cab_name: '' };
        if ('line_manager' in a) row.type = m.lineManagerStepType;
        else if ('adhoc' in a) row.type = m.adhocStepType;
        else if ('agent' in a) {
          row.type = m.agentStepType;
          row[m.approverIdKey] = refs[a.agent]?.id;
        } else if ('group' in a) {
          row.type = m.groupStepType;
          row[m.approverIdKey] = refs[a.group]?.id;
          row[m.minApproversKey] = a.min ?? 1;
        }
        return row;
      });
      return p;
    },
  },

  agent: {
    // Reuse only: plans name existing people. Evidence: GET /Agent lists agents by name.
    resource: 'Agent',
    template: '',
    build: () => {
      throw new Error('Creating agents is not supported: they are people with licences. Reuse an existing agent.');
    },
  },

  approval_group: {
    // Halo calls approval groups CABs. Evidence: GET /CAB lists "Human Resource Approval Group" etc.
    resource: 'CAB',
    template: 'template-cab.json',
    build: (step, refs) => {
      // Evidence: cab-4. members[] { agent_id, type 0 }; approvals_needed; template roles dropped.
      const p = fromTemplate(templateFileFor(step, 'template-cab.json'), 'CAB');
      p.name = step.name;
      p.members = (step.members ?? []).map((m) => ({ agent_id: refs[m]?.id, type: 0 }));
      p.roles = [];
      p.approvals_needed = step.approvals_needed ?? 1;
      p.all_must_approve = false;
      return p;
    },
    update: (step, refs, warn, current) => {
      if (!step.set?.add_members?.length) { warn('update: nothing to set'); return {}; }
      const members = ((current.members as Row[]) ?? []).map((m) => ({ ...m }));
      for (const a of step.set.add_members) {
        const id = Number(refs[a]?.id);
        if (members.some((m) => Number(m.agent_id) === id)) { warn(`add_members: ${a} is already a member`); continue; }
        members.push({ agent_id: id, type: 0 });
      }
      return { members };
    },
    verifyUpdate: (back, changes) => {
      const ids = ((back.members as Row[]) ?? []).map((m) => Number(m.agent_id));
      return ((changes.members as Row[]) ?? []).filter((m) => !ids.includes(Number(m.agent_id))).map((m) => `approval group: agent ${m.agent_id} not a member after saving`);
    },
  },

  ticket_type: {
    resource: 'TicketType',
    template: 'template-tickettype.json',
    update: (step, refs, warn, current) => {
      const m = SPIKE_MAP.ticketType;
      const out: Record<string, unknown> = {};
      const st = step.set ?? {};
      if (st.workflow) out.workflow_id = refs[st.workflow]?.id;
      if (st.approval) out.approval_process_id = refs[st.approval]?.id;
      if (st.team && m.teamName) out[m.teamName] = refs[st.team]?.name; // rule T1: team by NAME
      if (st.sla && m.sla) out[m.sla] = refs[st.sla]?.id;
      if (st.add_groups?.length || st.add_fields?.length || st.field_mandatory?.length) {
        // Rule U2 (2026-10-23): the form is one list. Send ALL existing rows back (ids kept) plus the new ones.
        const rows = keepRows(current[m.fields as string]);
        const shape: Row = { usage: 0, groupid: 0, enduserdetail: 1, techdetail: 1, enduseraction: 1, techaction: 1 };
        editFieldRows(rows, refs, st.add_fields, st.field_mandatory, shape, warn, formLabels(current));
        let seq = Math.max(0, ...rows.map((r) => Number(r.seq) || 0));
        for (const g of st.add_groups ?? []) {
          const gid = Number(refs[g]?.id);
          if (rows.some((r) => Number(r.groupid) === gid && Number(r.fieldid) === 0)) { warn(`add_groups: ${g} is already on this form`); continue; }
          rows.push({ fieldid: 0, groupid: gid, seq: ++seq, usage: 0, endusernew: 1, technew: 1, enduserdetail: 1, techdetail: 1, enduseraction: 1, techaction: 1 });
        }
        out[m.fields as string] = rows;
      }
      if (!Object.keys(out).length) warn('update: nothing to set');
      return out;
    },
    verifyUpdate: (back, changes) => {
      const m = SPIKE_MAP.ticketType;
      const out: string[] = [];
      for (const [k, v] of Object.entries(changes)) {
        if (k === m.fields) out.push(...checkFieldRows(back[k], v, 'form'));
        else if (JSON.stringify(back[k]) !== JSON.stringify(v)) out.push(`${k} is ${JSON.stringify(back[k])}, wanted ${JSON.stringify(v)}`);
      }
      return out;
    },
    build: (step, refs, warn) => {
      const p = fromTemplate(templateFileFor(step, 'template-tickettype.json'), 'TicketType');
      const m = SPIKE_MAP.ticketType;
      p.name = step.name;
      set(p, m.summary, step.name, 'default summary', warn);
      // Rule T4 (2026-10-19): a copied type keeps the source's "override with this template when logging
      // manually". New Joiner (copy of New Starter Request) got template 1, which switched every new ticket
      // back to New Starter Request. A new type must never inherit it.
      p.overridewiththefollowingtemplatewhenloggingmanually = -1;
      if (step.team) set(p, m.teamName, refs[step.team]?.name, 'default team', warn);
      if (step.sla) set(p, m.sla, refs[step.sla]?.id, 'default SLA', warn);
      if (step.approval) {
        set(p, m.approvalProcess, refs[step.approval]?.id, 'approval process', warn);
        // Display name copied from the template would otherwise still name the template's process.
        if ('approval_process_name' in p) p.approval_process_name = refs[step.approval]?.name ?? '';
      }

      if (!m.fields || !m.fieldId) {
        warn(`SPIKE_MAP gap: don't know how fields attach to a ticket type yet; skipped`);
      } else {
        // Replace the template's field rows entirely: they belong to the template's ticket type.
        p[m.fields] = (step.fields ?? []).map((f, i) => {
          const level = f.mandatory ? m.mandatoryValue : m.optionalValue;
          const row: Record<string, unknown> = {
            [m.fieldId as string]: refs[f.ref]?.id,
            seq: i + 1,
            usage: 0,
            groupid: 0,
            enduserdetail: 1,
            techdetail: 1,
            enduseraction: 1,
            techaction: 1,
          };
          for (const key of m.mandatoryKeys ?? []) row[key] = level;
          return row;
        });
        // Field groups attach as rows with groupid and fieldid 0 (evidence: tickettype-36 rows 10420/10424).
        const offset = (step.fields ?? []).length;
        for (const [i, g] of (step.groups ?? []).entries()) {
          (p[m.fields] as Record<string, unknown>[]).push({
            fieldid: 0, groupid: refs[g]?.id, seq: offset + i + 1, usage: 0,
            endusernew: 1, technew: 1, enduserdetail: 1, techdetail: 1, enduseraction: 1, techaction: 1,
          });
        }
      }
      return p;
    },
  },

  field_group: {
    // Evidence: fieldgroup-14. name + header; fields[] rows like a ticket type's, with mandatory 3/1.
    resource: 'FieldGroup',
    template: 'template-fieldgroup.json',
    build: (step, refs) => {
      const p = fromTemplate(templateFileFor(step, 'template-fieldgroup.json'), 'FieldGroup');
      const m = SPIKE_MAP.ticketType;
      p.name = step.name;
      p.header = step.label ?? step.name;
      p.fields = (step.fields ?? []).map((f, i) => {
        const row: Record<string, unknown> = {
          fieldid: refs[f.ref]?.id, seq: i + 1, usage: 1, tableid: 1,
          enduserdetail: 1, techdetail: 2, enduseraction: 1, techaction: 1,
        };
        for (const key of m.mandatoryKeys ?? []) row[key] = f.mandatory ? m.mandatoryValue : m.optionalValue;
        return row;
      });
      return p;
    },
    update: (step, refs, warn, current) => {
      const st = step.set ?? {};
      if (!st.add_fields?.length && !st.field_mandatory?.length) { warn('update: nothing to set'); return {}; }
      const rows = keepRows(current.fields);
      editFieldRows(rows, refs, st.add_fields, st.field_mandatory, { usage: 1, tableid: 1, enduserdetail: 1, techdetail: 2, enduseraction: 1, techaction: 1 }, warn, formLabels(current));
      return { fields: rows };
    },
    verifyUpdate: (back, changes) => checkFieldRows(back.fields, changes.fields, 'field group'),
  },

  status: {
    // Evidence: status-28 (On Hold). name + shortname; slaaction 'hold' pauses the SLA.
    resource: 'Status',
    template: 'template-status.json',
    build: (step) => {
      const p = fromTemplate(templateFileFor(step, 'template-status.json'), 'Status');
      p.name = step.name;
      p.shortname = step.name;
      if (step.sla_action !== undefined) p.slaaction = step.sla_action;
      if (step.colour) p.colour = step.colour;
      return p;
    },
    update: (step, _refs, warn) => {
      if (step.set?.sla_action === undefined) { warn('update: nothing to set'); return {}; }
      return { slaaction: step.set.sla_action };
    },
  },

  outcome: {
    // "Outcome" = an action button. Evidence: outcome-11 (Re-Assign). Name lives in `outcome` and `buttonname`.
    resource: 'Outcome',
    template: 'template-outcome.json',
    nameKey: 'outcome',
    build: (step, refs) => {
      const p = fromTemplate(templateFileFor(step, 'template-outcome.json'), 'Outcome');
      p.outcome = step.name;
      p.buttonname = step.name;
      // Template is a system action: don't inherit its behaviour or its keyboard shortcut.
      // INFERRED: systemid 0 = plain custom action (verify in NOTES.md).
      p.systemid = 0;
      p.hotkey = '';
      p.newstatus = step.new_status ? refs[step.new_status]?.id : 0;
      if (step.colour) p.colour = step.colour;
      // Rule O3 (2026-10-19): the icon comes from the template action. On gethandoveruk that was
      // "Triage Not Required", so every new forward action showed an X. Use the plan's icon, or a neutral one.
      // Evidence for the property: outcome-11 has icon "users" (a Font Awesome name).
      p.icon = step.icon ?? 'arrow-right';
      return p;
    },
  },

  workflow: {
    // Evidence: workflow-9. Internal links use LOCAL numbers (step_id, start_step/end_step, stage sequence),
    // so a cleaned copy keeps them. Global ids (id, fdid, guid) and flow_id are stripped by clean.ts.
    resource: 'Workflow',
    template: 'template-workflow.json',
    build: (step, refs, warn) => {
      const p = fromTemplate(templateFileFor(step, workflowTemplateFile()), 'Workflow');
      p.name = step.name;
      const inserts = [...(step.insert_steps ?? []), ...(step.insert_step ? [step.insert_step] : [])];
      return inserts.length ? applyInserts(p, inserts, refs) : p;
    },
    // Rule W3 (2026-10-23): add stages to an EXISTING workflow in place. Send its own steps and stages
    // back with the new ones added; its ids stay, so tickets already on it keep their place.
    update: (step, refs, warn, current) => {
      if (!step.set?.insert_steps?.length) { warn('update: nothing to set'); return {}; }
      const p = applyInserts({ steps: structuredClone(current.steps ?? []), stages: structuredClone(current.stages ?? []) }, step.set.insert_steps, refs);
      return { steps: p.steps, stages: p.stages };
    },
    verifyUpdate: (back, _changes, step) => {
      const names = ((back.steps as Row[]) ?? []).map((s) => String(s.name).toLowerCase());
      return (step.set?.insert_steps ?? []).filter((i) => !names.includes(i.name.toLowerCase())).map((i) => `workflow: stage "${i.name}" not there after saving`);
    },
  },
};

/** Every ref a step points at, so the builder can check order before running. */
export function refsOf(step: PlanStep): string[] {
  return [
    step.team,
    step.sla,
    step.approval,
    step.new_status,
    step.set?.workflow,
    step.set?.approval,
    step.set?.department_of,
    step.set?.team,
    step.set?.sla,
    ...(step.set?.add_groups ?? []),
    ...(step.set?.add_fields ?? []).map((f) => f.ref),
    ...(step.set?.field_mandatory ?? []).map((f) => f.ref),
    ...(step.set?.add_members ?? []),
    ...(step.set?.insert_steps ?? []).flatMap((x) => [x.enter_via, ...x.exits.map((e) => e.via)]),
    step.department_of,
    ...(step.approvers ?? []).map((a) => ('agent' in a ? a.agent : 'group' in a ? a.group : undefined)),
    ...[...(step.insert_steps ?? []), ...(step.insert_step ? [step.insert_step] : [])].flatMap((x) => [x.enter_via, ...x.exits.map((e) => e.via)]),
    ...(step.fields ?? []).map((f) => f.ref),
    ...(step.members ?? []),
    ...(step.groups ?? []),
  ].filter((r): r is string => Boolean(r));
}
