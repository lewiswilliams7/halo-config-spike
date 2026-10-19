# Spike notes

Goal: prove every v1 object can be created through the Halo API and works correctly in the UI.
Gate 1 passes when every row below is **works** (or the object is dropped from v1).

Halo version tested: \_\_\_ · Trial instance: \_\_\_ · Dates: \_\_\_

## Results per object

Method for each row: build one by hand in the UI → `npm run get -- <Resource> <id>` → rename to `fixtures/template-<resource>.json` → `npm run post -- <Resource> <fixture> --name "Spike copy"` → check it in the UI.

| Object | Endpoint | GET works | POST creates | Correct in UI | Result | Payload notes |
| --- | --- | --- | --- | --- | --- | --- |
| Team | `/Team` | ✅ | (reused) | ✅ | works | |
| Status | `/Status` | ✅ | ✅ | ✅ | works | |
| Priority | `/Priority` | | | | | |
| SLA | `/SLA` | ✅ | ✅ | ✅ | works | targets per priority |
| Custom field | `/FieldInfo` (not `/Field`: that is asset fields) | ✅ | ✅ | ✅ | works | `CF` prefix added by Halo; needs one save after create (F6) |
| Field group | `/FieldGroup` | | | | | |
| Category | `/Category` | | | | | |
| Approval process | `/ApprovalProcess` | ✅ | ✅ | ✅ | works | step type 10 = line manager |
| Approval rule | `/ApprovalProcessRule` | | | | | |
| Ticket type | `/TicketType` | ✅ | ✅ | ✅ | works | team by name; fields[] with mandatory 3 |
| Workflow | `/Workflow` | ✅ | ✅ | ✅ | works | copy + insert step (W1, W2); designer box TBC |

Result = **works** / **partial** / **blocked**.

## Findings log

- **2026-10-19:** Auth works. Client credentials token, scope includes `all`, expires in 32400s (9 hours).
- **2026-10-19:** `GET /Field` returns **asset fields** (IP Address, Serial Number, RAM…), not ticket custom fields. Ticket custom fields are expected under `/FieldInfo`. To confirm before changing the field translator.
- **2026-10-19:** Confirmed: ticket custom fields are **`/FieldInfo`** (416 records, `CF…` names). Negative ids are Halo system fields. Field translator now targets FieldInfo.
- **2026-10-19:** Trial has no "HR" team. Plan now reuses **Human Resources (id 6)**.
- **2026-10-19:** Template candidates: ticket type **HR Onboarding (36)**, approval process **Line Manager Approval Process (4)**, SLA **Service Request SLA (3)**.

- **2026-10-19:** Fixtures captured: fieldinfo 114/124/141/153/193, sla-3, approvalprocess-4, tickettype-36. Answers below.
- **2026-10-19:** Field type codes (`FieldInfo.type`): text 0, memo 1, dropdown 2, multi-select 3, date 4, checkbox 6. Label is `label`; `name` is the CF… internal name. Dropdowns hold `values: [{name}]` linked to a `lookup` table.
- **2026-10-19:** Ticket type links: `default_team` = team **name** (not id), `default_sla` = SLA id, `approval_process_id` = id, `workflow_id`, `default_priority`. Fields attach via `fields: [{fieldid, seq, endusernew, technew, ...}]`; field groups via `groupid`.
- **2026-10-19:** SLA targets are per priority: `priorities[].fixtime` + `fixunits` ('H'/'D'), with `workday_id`.
- **2026-10-19:** ⚠️ Copying a fixture as-is is DANGEROUS. Nested ids point at existing records: `fieldinfo.tickettypes` would attach a new field to existing ticket types, `lookup` would share an existing dropdown list, `sla.priorities[].slaid` and `tickettype.fields[].id` could modify the source records. Fixed with `lib/clean.ts` (deep-strips identity keys, parent pointers and link arrays), now used by both `post` and the builder.

- **2026-10-19:** ✅ **First API write.** `POST /FieldInfo` created field 310. Read back: attached to **0** ticket types, so the deep clean works.
- **2026-10-19:** Halo **prefixes custom field names with "CF" itself**. Sent `CFSpikeTest`, stored `CFCFSpikeTest`. Field translator now sends the bare name; builder expects `CF` + bare name when finding and verifying.

- **2026-10-19:** ✅ **Full build applied.** Fields 311–314, SLA 5, approval process 8, ticket type 56 created in order. Run log review found two template leftovers on the ticket type: `approval_process_name` still named the template's process, and `published_id` (a GUID) was copied. Both now fixed (`published_id` treated as identity in `clean.ts`). Need to check whether ticket type 56 shares HR Onboarding's portal form.

- **2026-10-19:** ✅ **Ticket form works.** Employee Onboarding shows all 4 fields, right types, right order; Start date and Department mandatory (confirms `endusernew`/`technew` = 3). Labels first showed `!#?UnknownString?#!` until a browser refresh: Halo's label cache, not a build bug. Product note: tell users to refresh Halo after a build.
- **2026-10-19:** ❌ **Dropdown has no options.** Sending `values: [{name}]` without a `lookup` id does not create a value list. Values live in a separate lookup table the field points at. Correction: Halo DID create the list (field 313 → lookup 175 with HR/IT/Finance, all active). Difference from a working dropdown (124): `inputtype` -1 vs 0 and `load_type` missing vs 0, both inherited from the text template. Fix: per-type templates (`template-field-dropdown.json` from fieldinfo-124). Testing with `plans/dropdown-test.json`. Result: field 315 now matches 124 on inputtype 0 / load_type 0 / extratype 1 / lookup 176 with 3 values. Remaining difference: `stored_in_table` FieldData (API-created) vs Faults (trial's built-in fields). Next: A/B against a dropdown built by hand in the UI, using `npm run diff`.
- **2026-10-19:** 🔎 **Browser capture (HAR) of the new-ticket form.** The form loads `GET /TicketType/{id}?includedetails=true&isnewticket=true&system_lookups=true`, and **our dropdown's values (HR/IT/Finance) ARE in that response**. So storage and access are fine: the browser hides them because of a field setting. Versus the only working dropdown on the form (308 CFAIAutoResolution), ours differs on: `visibility` (missing vs 1), `inputtype` (-1 vs 0), `load_type` (missing vs 0), and has empty `sqllookup`/`third_party_name`/`table_id`/`calcfield` keys that 308 doesn't have at all. Test 3 builds a dropdown from 308 as the template (`plans/dropdown-test-3.json`).
- **2026-10-19:** 🎯 **Root cause candidate: Halo drops `visibility` on create.** Field 316 (copied from working dropdown 308) differs from 308 only in expected ways, plus `visibility: 1` missing, though we sent it. Every working field has it; every API-built field lacks it. Tried setting it with an update: **❌ not saved**. Halo ignores `visibility` on create AND on partial update, so it's derived or saved another way. Good news from the same test: a partial update (`[{id, one property}]`) changed nothing else, so targeted edits are safe. Next: HAR of the UI saving field 316 to see how the screen sets it.
- **2026-10-19:** ✅ **SOLVED: dropdown options.** Saving field 316 in the UI (hint "X") made its options show, yet the before/after diff showed ONLY `hint` changed (`visibility` still missing). Then `npm run update -- FieldInfo 315 summary=x` via the API fixed field 315 too. Rule F6: a field needs one real save after creation. Earlier "update visibility" attempts didn't count because Halo ignored the property, so nothing actually changed. Builder now creates with a placeholder summary and clears it straight away.
- **2026-10-19:** 🏁 **Gate 1 technical half PASSED.** After `npm run update -- FieldInfo 313 inputtype=0 load_type=0` (a real save, rule F6), Employee Onboarding works end to end: 4 fields with correct types and labels, Start date + Department mandatory, Department shows HR/IT/Finance, team, SLA and approval set. Everything built through the API from one plan.
- **Next test: workflows.** A workflow is a graph (steps → steps, statuses, actions), so the deep clean can't be used as-is: internal ids must be REMAPPED, not stripped. Plan: create an action (Outcome) and a status, copy an existing workflow with links intact, add a stage using the new action/status, attach it to Employee Onboarding.
- **2026-10-19:** Workflow 9 anatomy (`GET /Workflow/9`): `steps[]` (local `step_id` 1..n, global `fdid`, `stage_number`, `isstart`, `islaststep`), each with `actions[]` (`start_step` → `end_step` as LOCAL step ids; `action_id` = global Outcome id, e.g. Resolve Ticket 4; `action_type` 1 = outcome, 3 = system event like End-User Update with `end_step -99`, 8 = approval result with `approval_result` 0 approved / 1 rejected). `stages[]` keyed by local `sequence`. `flow_chart_json` = designer layout (node_N = step N). Internal links are local, so a copy only needs global ids stripped (`id`, `fdid`, `guid`) plus the parent pointer `flow_id`. Open risk: new steps have no node in `flow_chart_json`.
- **2026-10-19:** Status/outcome evidence (status-28, outcome-11). Workflow test plan `plans/workflow-test.json`: status Awaiting Equipment (SLA hold) → action Equipment Ordered (newstatus) → copy of workflow 9 with a new step between Request Fulfilment and Closed → partial update of Employee Onboarding `workflow_id`. Mock run: all payloads clean, links correct. To verify: systemid 0 = plain action; designer shows the new step.
- **2026-10-19:** First real workflow run stopped at step 3: reusing "Resolve Ticket" failed because Outcome LIST rows only carry `buttonname` (full records also have `outcome`). It had already created status 30 and outcome 90. Fixes: lookups check all name-like properties (S8), and a pre-flight resolves every reuse/update target before any write (S7). Re-run will reuse 30 and 90.
- **2026-10-19:** 🏁 **WORKFLOW TEST PASSED.** Workflow 20 "Employee Onboarding Workflow" built from a copy of workflow 9 with a new step, stage and two actions; Employee Onboarding switched to it via partial update. In the UI: new stage shows, Equipment Ordered appears, moves the ticket to Awaiting Equipment, Resolve closes it. Approval auto-skipped because the test user has no line manager (correct Halo behaviour). Plans need a way to name approvers (agent / team / role), so approval step types beyond 10 must be mapped next. Designer view of the new step: still to check.
- **2026-10-19:** Approval step types (`steps[].type`), from processes 1/2/3/4/7/8: **10** line manager · **1** named agent (`agent_id_or_cab_id` = agent id) · **3** approval group/CAB (`agent_id_or_cab_id` = group id, `minapprovers`) · **8** ad-hoc (agent chooses) · **42** change CAB (`minapprovers`). Multi-stage = several steps ordered by `sequence`. Teams don't approve; approval groups (CABs) do. Quirk: `agent_name` and `cab_name` are both filled from the same id regardless of type (process 2 shows an agent AND a CAB name); only the one matching `type` is real. Endpoints confirmed: `/Agent` (people) and `/CAB` (approval groups). Plans now take `approvers: [{group, min} | {agent} | {line_manager} | {adhoc}]`; test plan `plans/approval-test.json`.
- **Method note:** a HAR capture of a Halo screen shows exactly what the UI loads. Faster than guessing; use it whenever the UI disagrees with the API.

## To verify in the Halo UI (inferred, not yet proven)

- [x] Mandatory = `endusernew`/`technew` **3** (optional = 1). Confirmed on Employee Onboarding.
- [ ] Approval step `type` **10** = requester's line manager. Check: open Line Manager Approval Process, see what the step's approver is set to.
- [x] Posting a dropdown with `values: [{name}]` and no `lookup` DOES create a new value list (lookup 175/176/177). Options only show after rule F6.

## Open questions

- [x] Fields attach via `fields[]` with `fieldid` (properties known; write still to be tested).
- [x] Field type codes: answered above.
- [ ] Dropdown options: `values` + `lookup` table. Does posting values create the list? (write test)
- [x] SLA targets: per priority, `fixtime` + `fixunits`.
- [ ] Workdays: can they be created over the API, or only reused?
- [ ] "Email the manager on submit": approval process, ticket type, or an automation?
- [ ] How is "requester's line manager" expressed on an approval process?
- [ ] Minimum API permissions needed for config writes (start with `all`, then narrow).
- [ ] Does POST with an `id` update in place? (Needed later for "update" actions.)

## SPIKE_MAP

As you answer the questions above, fill the nulls in `spike/lib/translators.ts` → `SPIKE_MAP`.
`npm run build:onboarding` (dry run) prints a warning for every gap still open.

## Demo checklist

- [ ] Fresh trial instance with an "HR" team and nothing else from the plan
- [ ] `npm run build:onboarding` shows zero warnings
- [ ] `npm run build:onboarding -- --apply` builds everything, all verified
- [ ] Screen-record: the request text → the run → the new ticket type in Halo, raised as a user
- [ ] Voiceover, under 90 seconds
