/**
 * Make a fixture safe to POST as a NEW record.
 *
 * Copied Halo objects carry nested ids that point at OTHER existing records.
 * Posting them unchanged can silently modify existing config (found 2026-10-19):
 *   - fieldinfo.tickettypes / fieldgroups   → would attach the new field to existing ticket types
 *   - fieldinfo.lookup + values[].lookupid  → new dropdown would share an existing value list
 *   - sla.priorities[].id / slaid           → could overwrite an existing SLA's targets
 *   - tickettype.fields[].id / rtid         → could move field rows off an existing ticket type
 *   - access_control[].entity_id, translations[].entity_id → point at the source record
 *   - outcome.workflows                     → would add a new action to every workflow the template is in
 *   - workflow steps/actions flow_id, fdid  → point back at the template workflow
 *
 * Rule: drop every own-identity key (id, guid) at every depth, drop parent pointers,
 * and drop arrays that link the record to other records. Keep plain references the
 * plan sets on purpose (fieldid, groupid, workday_id, default_sla, ...).
 */

const IDENTITY_KEYS = new Set(['id', 'guid', 'pk', 'published_id']);
const PARENT_POINTER_KEYS = new Set(['rtid', 'slaid', 'processid', 'lookupid', 'entity_id', 'entity_id2', 'criteriagroup_id', 'flow_id', 'fdid', 'team_id', 'cab_id']);
const LINK_ARRAYS = new Set([
  'tickettypes', //   fieldinfo/status/outcome → ticket types it's attached to
  'workflows', //     outcome → workflows it's attached to (outcome-11 had 20)
  'fieldgroups', //   fieldinfo → groups it's in
  'outcomes',
  'access_control',
  'translations',
  'children',
  'kanbanstatuschoice',
  'group_visibility_conditions',
]);
const DROP_KEYS = new Set(['lookup', 'labellong', 'variable_name']);

export function cleanForCreate<T>(value: T): T {
  return clean(structuredClone(value)) as T;
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_KEYS.has(key) || PARENT_POINTER_KEYS.has(key) || LINK_ARRAYS.has(key) || DROP_KEYS.has(key)) continue;
    out[key] = clean(v);
  }
  return out;
}
