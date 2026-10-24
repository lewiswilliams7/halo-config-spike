# Halo build rules

Every rule here was learned the hard way during the spike, on a real Halo instance. The product must enforce all of them automatically, so customers never hit these issues. Each rule says what goes wrong without it and where it's already handled in the spike code.

Add a rule every time Halo surprises us. Never remove one without proof it's no longer true.

## Connecting

| # | Rule | Without it | Spike code |
|---|---|---|---|
| C1 | Use a Halo API application with **Client ID and Secret (Services)**, login type **Agent** (admin agent). Scope `all` during the spike; find the minimum later. | Auth fails or writes are refused | `lib/halo.ts` `getToken` |
| C2 | Tokens last **9 hours** (`expires_in` 32400). Cache and refresh before expiry. | Long builds fail midway | `lib/halo.ts` |
| C3 | All writes go through one guarded function with an explicit "this instance is allowed" switch. | A build hits the wrong instance | `lib/halo.ts` `haloPost` |

## Finding the right endpoint

| # | Rule | Without it | Spike code |
|---|---|---|---|
| E1 | Ticket custom fields are **`/FieldInfo`**. `/Field` is **asset** fields. | Fields created in the wrong place | `translators.ts` field `resource` |
| E2 | Dropdown values live in a separate lookup table: `/Lookup?lookupid=<id>`. The field points at it via `lookup`. | Can't read or verify options | `get.ts` query params |
| E3 | List endpoints return either an array or an object wrapping one. Handle both. | Lists look empty | `lib/halo.ts` `extractList` |
| E4 | POST takes an **array** of objects, and returns the created object (or an array). | Create fails or id is lost | `lib/halo.ts` `firstRecord` |

## Creating safely (the big one)

| # | Rule | Without it | Spike code |
|---|---|---|---|
| S1 | **Never POST a copied object as-is.** Nested ids point at existing records. Deep-strip identity keys (`id`, `guid`, `pk`, `published_id`), parent pointers (`rtid`, `slaid`, `processid`, `lookupid`, `entity_id`…) and link arrays (`tickettypes`, `fieldgroups`, `access_control`, `translations`…). | A new field attaches itself to existing ticket types; a new dropdown shares an existing value list; a new SLA can overwrite an existing SLA's targets; a new ticket type can steal field rows from the template | `lib/clean.ts` |
| S2 | Never create without checking for an existing record with the same name first. Reuse it if found. | Duplicates on every re-run | `build-onboarding.ts` `findByName` |
| S3 | Read every object back after creating it and compare with the plan. | Silent partial saves | `build-onboarding.ts` |
| S4 | Replace display-name fields copied from a template (e.g. `approval_process_name`) with the real linked name. | Config screens show the template's names | `translators.ts` ticket_type |
| S5 | Stop at the first hard failure. Never continue a build on a broken dependency. | Half-built config pointing at nothing | `build-onboarding.ts` |
| S7 | **Pre-flight before any write**: resolve every existing object the plan reuses or updates first. If any is missing, write nothing. | Half-built config: a run created a status and an action, then stopped on a lookup | `build-onboarding.ts` pre-flight |
| S8 | Look names up across all name-like properties (`name`, `label`, `buttonname`, `outcome`): list rows and full records don't always use the same one. | "Not found" for objects that exist (Outcome list has only `buttonname`) | `build-onboarding.ts` `findByName` |
| S9 | The SLA clock only runs in the SLA's working hours. A ticket raised on a Friday evening shows 0% used and its targets start Monday 09:00 (ticket 4007: respond by Mon 26 Oct 13:00, fix by Mon 2 Nov 09:00, exactly 5 working days). Test SLA pausing inside working hours. | "No SLA" reported on a ticket that has one | test guidance |
| S6 | Never delete anything. | Irreversible damage to a live service desk | (none, by design) |

## Object-specific rules

| # | Rule | Without it | Spike code |
|---|---|---|---|
| F1 | Halo **adds "CF" to custom field names** itself. Send the bare name; expect `CF` + name back. | `CFCFOnboardStartDate`; re-runs can't find what they built | `translators.ts` `bareFieldName`, `storedName` |
| F2 | Field type codes (`FieldInfo.type`): text **0**, memo **1**, dropdown **2**, multi-select **3**, date **4**, checkbox **6**. | Wrong input type on the form | `SPIKE_MAP.fieldTypes` |
| F3 | Build each field type from a **template of the same type**. A text template gives dropdowns `inputtype -1` and no `load_type`. | Dropdown shows no options even though the values exist | `translators.ts` `template-field-<type>.json` |
| F4 | Clear template defaults: `hint`, `defaultvalue`, `defaultvalue_lookup`. | New field pre-filled with e.g. "Standard Laptop" | `translators.ts` field |
| F5 | Dropdown options: send `values: [{ name }]` with no `lookup` id. Halo creates a new lookup table. | Shares another field's list (if `lookup` kept) | `translators.ts`, `clean.ts` |
| T1 | Ticket type `default_team` takes the team **name**, not its id. `default_sla` and `approval_process_id` take ids. | Team not set | `SPIKE_MAP.ticketType` |
| T2 | Attach fields with `fields: [{ fieldid, seq, endusernew, technew, … }]`. Mandatory = `endusernew`/`technew` **3**; optional = **1**. Replace the template's field rows entirely. | Missing fields; wrong mandatory flags; template's fields copied in | `translators.ts` ticket_type |
| T3 | A new team inherits its **department** (and settings like live chat) from whichever team it was copied from. Copy from a team in the right department (`based_on`) and set `department_of` to a reused team. | Team created but filed under the wrong department (People Operations landed in IT), so it looked missing | `translators.ts` team, plan `department_of` |
| T4 | A copied ticket type keeps `overridewiththefollowingtemplatewhenloggingmanually` (a ticket template applied when an agent logs it). That template can carry its own ticket type, so picking the new type flips to the old one. Always set it to **-1** on create. | Picking New Joiner jumped straight to New Starter Request | `translators.ts` ticket_type |
| T5 | A ticket type's form includes Halo's own fields (Details, Agent, Followers, category, hidden AI fields). When creating from a template, keep its loose rows except its VISIBLE custom fields; only replace the template's own questions. | New Joiner had no Details box or Followers (found 23 Oct) | `translators.ts` isStandardRow |
| T6 | A new ticket type's form = the fields and sections the plan lists, plus Halo's standard fields. `based_on` does NOT bring the source's sections, so a plan must list them; a plan that lists none keeps the source's form whole. | Normal/Emergency Change would have had no Change sections (G5 dry run, 23 Oct) | `translators.ts` ticket_type, planner rules |
| T7 | **Halo rejects creating a ticket type whose form is tabbed (`tab_display` 1) with a bare 500.** Found by bisect: a plain copy of Change Request failed, Service Request didn't, and `tab_display` was the one setting. Create with `tab_display` 0, then switch it back on in a follow-up save. | Emergency Change (copy of Change Request) could never be created | `translators.ts` ticket_type + afterCreate |
| A1 | SLA targets are per priority: set `priorities[].fixtime` + `fixunits` (`H` or `D`) on every row. Reuse an existing `workday_id`. | SLA created with the template's targets | `translators.ts` sla |
| P1 | Approval step `type`: **10** line manager, **1** named agent, **3** approval group (CAB) + `minapprovers`, **8** ad-hoc, **42** change CAB. Approver id goes in `agent_id_or_cab_id`. Multi-stage = more steps by `sequence`. | Wrong approver | `SPIKE_MAP.approval` |
| P2 | Teams can't approve; approval groups (CABs) do. Map "the HR team approves" to an approval group, and create one if needed. | Plan asks for something Halo can't express | planner |
| P4 | **A line-manager approval stage errors ("Step 0") when the requester has no line manager**; it does not skip. Proven by A/B: same 2-stage process with a named agent instead works. Before building one, check how many users lack a manager and warn, or add a fallback approver. | Live tickets stuck in a broken approval | planner pre-build check (to build) |
| P5 | What P4 looks like on a real ticket (ticket 4007, 23 Oct): stage 1 approves, then the line-manager stage creates NO approval records, the ticket gets `faultapprovalfailed: true` and `status_change_frozen: true`, and the history shows "Awaiting Approval" → "Approved". It looks auto-approved but is actually stuck. The user record read through the API (`/Users/{id}?includedetails=true`) has no manager field at all, so the pre-build check needs the field found first. | Agents think approval worked; ticket can't move | diagnose.ts; pre-build check (to build) |
| P6 | **A user's line manager can only be set by an AD / Entra sync, not by hand** (confirmed in the UI, 23 Oct). So line-manager approval only works on instances that sync managers from AD. The planner must ask before using it, and offer a named approver or group otherwise. | Approval that can never work on instances without AD manager sync | `plan.ts` rules |
| P3 | Ignore `agent_name`/`cab_name` when reading approval steps: Halo fills both from the same id whatever the type. Read `type` + `agent_id_or_cab_id`. | Misreading who approves (shows an agent AND a group) | (reader, to build) |

| U0 | Partial updates are safe: `POST [{ id, changedProp }]` leaves every other property alone (proven on FieldInfo 316). | Updates would need full objects and risk wiping config |
| F6 | **A new field only works fully after one real save following creation.** Without it, dropdowns show no options even though the values exist and reach the form. Create, then send one real partial update (the builder sets a placeholder `summary` and clears it). An update that changes nothing (e.g. an ignored property) does NOT count. `visibility` turned out to be a red herring. | Dropdowns show no options | `translators.ts` `afterCreate`, `build-onboarding.ts` |
| F6b | **Unconfirmed (23 Oct), kept as harmless:** F6 was proven on a field already on a form. On gethandoveruk the save straight after creation didn't make G3's dropdown options show. The builder now also re-saves every new dropdown/multi-select at the END of the build, after all forms are built. Confirm with a manual re-save of field 339. | Dropdowns empty after a full build | `build-onboarding.ts` end of run |

| W1 | Workflow links are LOCAL: `steps[].step_id`, `actions[].start_step/end_step`, `stage_number` → `stages[].sequence`. Copy them as-is; strip only global ids (`id`, `fdid`, `guid`) and the parent pointer `flow_id`. | Copy cut off from its own steps, or steps attached to the template workflow | `clean.ts`, `translators.ts` workflow |
| W2 | To add a step: next free `step_id`, insert a stage and shift later stages' `sequence` and steps' `stage_number` by one; add an entry action on the step before and exit actions on the new step. | Broken progress bar; unreachable step | `translators.ts` workflow `insert_step` |
| O1 | Outcomes (actions) keep their name in `outcome` + `buttonname`, not `name`. `newstatus` = status id to move to. | Can't find or verify actions | `translators.ts` outcome `nameKey` |
| O2 | Copied outcomes carry `workflows: [...]` (attach to every workflow), `systemid` (system behaviour) and `hotkey`. Strip/reset all three. | New action appears in 20 workflows; behaves like the template's system action | `clean.ts`, `translators.ts` outcome |
| O3 | A new action copies the template action's `icon` (a Font Awesome name, e.g. `users`). Copied from "Triage Not Required", every forward action showed an X. Always set the icon: the plan's `icon`, else `arrow-right`. | Forward actions look like cancel buttons | `translators.ts` outcome |

| D1 | **Templates come from the connected instance, never another one.** Discovery picks a real object of each kind from the customer's own Halo and stores it per instance (`fixtures/templates/<host>/`). Another instance's templates carry its ids (workdays, lookups, statuses). | Wrong or dangling references on a customer's Halo | `lib/discover.ts`, `halo.ts templateRel` |
| D2 | Pick templates by evidence: same field type with real values for lookups; a service-request ticket type (`itilrequesttype` 3); a plain status (not New/Closed); a non-system action (`systemid` 0); a plain approval process (types 1/3/10, not change CAB 42); workflows copied BY NAME (`copy_of`). | Inheriting the wrong behaviour from an odd template | `lib/discover.ts` |
| D3 | **"Any valid example" is not a good template.** Defaults avoid special cases: lookups only from static-list fields (`extratype` 1); service-request ticket types that aren't bookings/projects/tasks; statuses Halo treats specially (New, Closed, Draft…); actions that close/approve/escalate. Better still, plans name the template (`based_on` / `copy_of`) so the customer sees and approves the choice. | Multi-select showed "Americas/EMEA" from a region-fed template; Desk Booking chosen as a ticket type template | `lib/discover.ts`, `translators.ts templateFileFor` |
| M1 | Teams: members are `agents: [{ agent_id }]`. Approval groups (CAB): `members: [{ agent_id, type 0 }]`, `approvals_needed`; drop template `roles`. Field groups: `name`, `header`, `fields[]` rows; attach to a ticket type as a row with `groupid` and `fieldid 0`. Strip `team_id`/`cab_id` from copied rows. | Template's members copied into the new team/group | `translators.ts` |

## Changing what already exists (added 2026-10-23; U2, U3, W3, F7 proven on gethandoveruk the same day)

| # | Rule | Symptom it prevents | Where |
|---|---|---|---|
| U2 | A form (ticket type `fields`, field group `fields`) is ONE list. To add or change a field, send every existing row back (row ids kept, nested `group`/`fieldinfo` display objects dropped) plus the new rows. Verify by reading back and finding each field/group row. | Adding one field wipes the rest of the form | `translators.ts` keepRows / editFieldRows |
| U3 | Compute an update from the record as it is NOW (detail read just before), and drop changes that are already true. | Stale overwrites; "updated" reported when nothing changed | `build-onboarding.ts` update path |
| U4 | Updates must be safe to re-run: a stage, field, section, option or member that's already there is skipped silently, not added again and not treated as a problem (B1 would otherwise block every re-run). | "Workflow already has a step named Assessment" on re-running G5 | `translators.ts` updates |
| W3 | Stages can be added to an EXISTING workflow in place: send its own steps and stages back with the new ones added; existing steps keep their local `step_id`, so tickets already on them stay put. | Customers forced into a copied workflow they didn't ask for | `translators.ts` applyInserts + workflow update |
| W4 | A new stage must be entered by an action that ISN'T already on the step before it; otherwise one button has two destinations. The builder refuses it, the planner checks it against the actions per stage. | Submit for Approval and Initiate Change reused in G5 plan | `translators.ts` applyInserts, `plan.ts` validate |
| F7 | New dropdown options go on the end of the field's `values` as `{ name }`; existing values are sent back with their ids. | Options lost or duplicated | `translators.ts` field update |
| F8 | Before adding a field to a form, compare its label with every label already on the form, including inside sections ("Start date" vs "Starting Date"). Skip the new field on a match (and say so); make the existing one mandatory instead. | Two start-date fields on HR Onboarding (23 Oct, real instance) | `translators.ts` sameMeaning / formLabels |
| F9 | Halo's standard field names aren't unique: FieldInfo has more than one "FProjectStartDate" (-19 and -105). Match a standard field to a form by the form row's own field name, not a global lookup. | "isn't on this form" when making Change Scheduling's dates required (G5) | `translators.ts` sameField / rowNames |
| M2 | The planner must see SETTINGS, not just names: each ticket type's team, SLA, approval, workflow and form (mandatory marked), field labels/types/options, field group contents, statuses that pause the SLA, approval group members, approval stages, SLA targets. | Planner marks built things as partial, asks questions it could answer, creates near-duplicates | `lib/inventory.ts` details |
| M3 | Never create a near-copy of an existing object (same name plus a suffix, "v2", "(copy)"): update the original. The planner's checks reject it. | Duplicate workflows, groups and ticket types on live instances | `plan.ts` validate |
| M4 | The planner must not create objects nothing uses (an approval process kept "for later"), must reuse Halo's standard fields (symptom, risk, fbackoutplan) instead of adding look-alikes, must update an existing ticket type that already covers a requested one, and may only use priorities that exist on the instance's SLAs. | Unused approval, duplicate Risk/Backout fields, "Normal Change" next to Change Request, Urgent target skipped (G5) | `plan.ts` rules + validate |
| M5 | A threshold on a number (cost over £300) is its own new dropdown holding only the bands ("Under £300", "£300 or more"). Never add band options to an existing field or mix them into another answer ("Laptop (£300 or more)"). | Planner folded cost bands into the shared Hardware field, changing every form that uses it (app test, 24 Oct) | `plan-checks.ts` |
| M6 | If an approval should only run under a condition we can't build yet, don't attach the approval process to the ticket type: attached, it runs on every ticket. Keep it off and list the conditional approval as unsupported, unless an assumption says every ticket is approved. | Plan for "over £300 comes to me" would have sent every New Starter for approval (app test, 24 Oct) | `plan-checks.ts` |
| M7 | Questions must change what gets built: at most 2 on a follow-up, never repeat one the user has replied to ("either" means the planner decides and records it in assumptions), never ask the user to confirm their own words, never use internal field names. | Four turns re-asking the name, the team and the cost options (app test, 24 Oct) | `plan-checks.ts` |

## Reading

| # | Rule | Symptom it prevents | Where |
|---|---|---|---|
| R1 | Halo answers 504 (and can answer 429/502/503) when read hard, e.g. many detail GETs in parallel from a distant server. Retry reads with back-off (honour Retry-After), at most 4 at a time; never retry writes. Run the app in the same region as the customer's Halo where possible. | "Halo GET /api/Workflow/9 failed (504)" on the first in-app read (24 Oct) | `lib/halo.ts` haloGet, app `lib/specflow/halo.ts` |

## Build safety

| # | Rule | Symptom it prevents | Where |
|---|---|---|---|
| B1 | An apply first dry-runs the whole plan; any warning, pre-flight gap or failure means nothing is written (`--allow-warnings` overrides after checking). Each step also refuses to write if it raised a warning. A failed step logs exactly what it tried to send. | G5 was applied with two warnings showing and stopped at step 32 of 32, half-built | `build-onboarding.ts` |

## After a build

| # | Rule | Without it |
|---|---|---|
| U1 | After a build, tell the user to **reload Halo (F5)**. Labels for new fields are in Halo's language pack on the server immediately (proven: `labelcheck` showed field_320 straight after creation), but the browser loads that pack once per page load (single-page app), so screens show `!#?UnknownString?#!` until a full reload. No log-out needed. | Looks broken when it isn't |
| U1b | New dropdown options can stay hidden after F5 until the user **logs out and back in** (G3, 23 Oct: options appeared only after a log-out; the field records were identical to working ones). The build report must say: reload Halo; if new dropdowns look empty, log out and back in. | "Dropdowns are broken" support tickets after every build |
