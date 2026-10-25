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
- **2026-10-19:** Workflow designer shows the new step and the Equipment stage works end to end. ✅
- **2026-10-19:** Approval test: stage 1 (HR approval group, type 3) ✅ asked Robert James + Jennifer Williams and accepted. Moving to stage 2 (line manager, type 10) → "There was an error with this approval process … Step 0". Suspects: (a) requester has no line manager, (b) sequence numbering (we used 1, 2; Halo's process 1 uses 10). A/B: `plans/approval-test-2.json` makes stage 2 a named agent.
- **2026-10-19:** ✅ Approval A/B result: HR group → named agent (Kaleem Smith) works end to end. So "Step 0" was the line-manager stage with no manager on the requester (rule P4), not our step numbering (stored sequence 1, 2 as sent). Product idea from this: **pre-build checks against the customer's data** (e.g. users without managers) with a suggested fix.
- **2026-10-19:** Evidence for Tier 1: team-6 (members = `agents[]`), cab-4 (`members[]`, `approvals_needed`, `roles`), fieldgroup-14 (`name`, `header`, `fields[]`). Category detail still needed.
- **2026-10-19:** **Template discovery built** (D1, D2): no more hand-copied templates. Builder reads the connected instance, picks its own objects as templates, stores them per instance. `npm run scan` shows the profile + picks. Mock run on the trial's real data picked: text 141, memo 114, date 153, dropdown 124, checkbox 193, multiselect 131, ticket type 36, SLA 3, status 28, outcome 11, workflow 9 by name, team 6, CAB 4, field group 14. Tier 1 plan built clean on the mock.
- **2026-10-19:** Tier 1 on the real trial: team "Onboarding Team" (Kaleem + Jennifer) ✅, approval group "Onboarding Approvers" (Jennifer) ✅, checkbox ✅. ❌ Multi-select showed Americas/EMEA: discovery picked CFMIImpactedLocations (fed by a built-in list) as template, so our values were ignored. Real scan also picked poor templates (Desk Booking, Draft, Problem Management, Escalate). Fixes: static-list-only lookup templates, avoid lists, and `based_on` in plans (D3). Retest: `plans/tier1-test-2.json` after `npm run scan -- --fresh`.
- **2026-10-19:** ✅ Equipment Request v2 works (multi-select from a static-list template shows Monitor/Keyboard/Headset; based_on "HR Onboarding" used). Labels needed a log out/in. Investigating whether the stale labels are browser-session or server-cached: `npm run labelcheck -- <field ids>` reads /agent/me's language pack via the API. Also: scan picked our own "Equipment Request" (id 59) as the default ticket type template, another reason plans should name templates (D3).
- **2026-10-19:** ✅ Label cache solved: `labelcheck` showed field_320 "Label test one" in the server's language pack straight after creation, and F5 (no log-out) showed it in the UI. Stale labels are the browser's once-per-page-load copy. Rule U1 updated: "reload Halo (F5)".
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

## 2026-10-19: enterprise JML test (gethandoveruk)

- 47 steps built and verified on the real instance: team, 2 approval groups, 22 fields, 4 field groups, 3 SLAs, 2 approval processes, 3 actions, a two-stage inserted workflow, 3 ticket types.
- People Operations "missing": it was created (id 12) but in department "Handover - IT" (3), copied from template team 1st Line Support, and with live chat on. Rule T3: copy from a team in the right department (`based_on`) and set `department_of`.
- New Joiner (57) vs New Starter Request (17): no field points back at 17 (initial_status 17 is a status id). New Joiner has its own two field groups (33, 34), its own workflow, SLA, approval and team. If a "New Joiner" link opens the New Starter form, it isn't the ticket type; still to find where the link lives.
- Found it: New Joiner inherited `overridewiththefollowingtemplatewhenloggingmanually = 1` from New Starter Request; template 1 sets the type back to New Starter Request. Rule T4: reset to -1 on create. Existing 57/58/59 fixed with `npm run update`.

## 2026-10-23: planner test (G1) on a populated instance

- gpt-4.1: invalid after retry; half reuse/half create, near-duplicate field, invented workflow, no stages.
- gpt-5: valid first time, consultant-quality questions (CFJoinerManager vs requester's manager), but rebuilt the existing JML as "v2" copies.
- gpt-5 + gap analysis: 17 steps, no duplicate ticket types; still marked built things as partial, near-duplicate approval groups and field, 8 questions. Cause: inventory had names only.
- Fixes: detailed inventory (M2), updates to existing objects (U2, U3, W3, F7, team/approval-group members, status hold), near-copy rejection (M3), max 4 questions.
- Fixed bug: rule O3 icon had been applied to statuses, not actions.
- Real-instance update test (update-test.json) passed on gethandoveruk: field label + new option, field added to a section, field added to HR Onboarding as mandatory, member added to an approval group, new stage added to the LIVE Service Request Workflow (with approval). All verified and checked in the UI.
- Found: HR Onboarding now has "Start Date" next to the existing "Starting Date" (my test plan's mistake). Rule F8 warns on same-meaning labels when adding fields.
- Planner re-run with settings: 7 steps, 17 of 18 coverage calls right. Wrong: thought People Operations lacked members (team members weren't in the read). Added team members and actions per workflow stage to the read.

## 2026-10-23: G2 run-through, ticket 4007 (New Joiner)
- Stages and actions work in the UI.
- SLA IS on the ticket: sla_id 6 "Joiner - 5 working days", respond by Mon 26 Oct 13:00, fix by Mon 2 Nov 09:00 (5 working days from Monday 09:00). Raised Friday 22:35, so 0% used. SLA built correctly; identical to Service Request SLA apart from targets. Rule S9.
- Approval: stage 1 (People Approvers) approved (admin override by lewis). Stage 2 (line manager) created no approval records; faultapprovalfailed true, status frozen. End user Ahmed Hassan's API record has no manager field. Rule P5. Next: set his manager in the UI and re-read Users/51 to find where Halo stores it.
- Lewis confirmed in the UI: a user's line manager is an AD-only field. Rule P6; planner now asks about AD manager sync before using line-manager approval.
- New Joiner was created without Halo's standard form fields (Details, Followers): T2 replaced the whole form. Rule T5 keeps them; joiner-approval-fix.json puts them back on New Joiner and swaps line manager for a named approver (P6).
- SLA runs on "Default Working Hours" (Mon-Fri 09:00-17:00). To test SLA pausing out of hours, set it to 24/7 in the UI.

## 2026-10-23: G3 and G5
- G3 (zero-touch rebuild, g3-rebuild.json): 50/50 on gethandoveruk, every object verified, no warnings. UI checks pending.
- G5 (change management) planner: strong reuse and questions, but the dry run + plan review found: duplicate Risk/Backout Plan (caught by F8), new change types without their sections (T6), reused actions entering new stages (W4), an unused approval process and an Urgent SLA target (M4). All fixed; G5 to be re-planned.
- G5 re-run: "Workflow already has a step named Assessment" (rule U4: updates skip what's already there). Change Scheduling dates not made mandatory: FieldInfo has two FProjectStartDate records (-19, -105); form uses -105 (rule F9).
- Emergency Change create returned 500: payload to be captured from the next dry-run log.
- Emergency Change 500 solved by bisect-tt (8 tries): `tab_display` 1 on create. Rule T7. Variants that ruled out: approval, SLA, ITIL type, portal fields, type-change settings, name, risk calculation, workflow, the -78 template-parent field. Hidden test types 63-66 ("zz Specflow test ...") were created during the search; remove by hand.
- The edited Change Management Workflow was NOT the cause.

## 2026-10-24: emails, ticket rules, child tickets, section visibility, runbooks (rule B2)
- Probe evidence only (endpoint names, list-row keys): EmailTemplate header_text/body_html; Outcome sendemail/emailtemplate_id; TicketRules criteria + new_*; /Template; section rows group_visibility_conditions(_value); CustomIntegration/Webhook.
- Built the plan format, translators, discovery, preview text and checks for all of them, with every unknown as null in SPIKE_MAP. Rule B2 keeps each area off until its nulls are filled from a capture. Mock test: with the map filled, a plan with all four builds clean; ticket rule criteria reuse the P7 row.
- Evidence: `npm run learn -- --apply` makes "zz Enact sample" records on the trial (email template, emailing action, ticket rule, child template; a section condition experiment only if none exists) and reads back what Halo kept, adapting from what it reads. Nothing made by hand. `capture:next` stays for capturing by-hand examples.
- Learning run 1 (gethandoveruk): email template sample -100 kept everything (name, header_text, body_html; body_text derived). Outcome `sendemail` is a number (posting true: 400); every action read has 2. Ticket rules: Halo's own rules give requesttypenew criteria, new_teamid/new_team, new_priority_id (number; /Priority ids are guids, so our test post failed). Sample rule 27 stored our type 23 dropdown criterion as sent. Templates have `children` (none of 6 read had any); New Starter / Leaver / Major Incident point at templates 1/30/10. Five conditional fields in Halo's standard types gave the V1 shape. Runbooks are Webhook records with a flowchart.
- Switched on: ticket rules (team/agent) TR1/TR2 and conditional fields V1. Learning run 2 proves both with the real builder on the trial, and hunts the send number, priority number, child templates and a runbook.
- Learning run 2 (25 Oct): builder proof refused (B1) by my bug: a field created in the plan got a NaN id in the dry run, so "is it on the form" failed. Fixed (V1 note). Emails: Email User = sendemail 1, hidesendemail false, includeto true (E1); sample 106 kept it, but had inherited default team 2nd Line Support from "Escalated" (O4). Priorities: per-SLA rows, priorityid = level (TR2). Child tickets: templates 1 and 30 show parent type 1 + type 6 children + ticket type link (C1). Runbooks: Webhook records with event triggers and flowchart steps; only Halo's own exist.
- Switched on: emails from actions (E1, O4), rule priority (TR2). Child tickets built, held back for the round 3 proof.
- Learning run 3 (25 Oct): the real builder (B1 gate, apply, verify) built and read back on gethandoveruk: ticket rule 28 (requesttypenew 69 + CFNumberOfLicences option 3, team 1st Line Support, priority 2, nothing else carried over), conditional field 366 on Software Licensing Request (condition group 162), email template -103 and action 107 (sendemail 1, includeto, template -103, no default team). Child tickets: parent with NEW children inline → bare 500 (ticket type 70 "zz Enact sample request" was created first). Round 4 tries children as their own records, then linked. Earlier Enact actions don't carry a default team (only sample 106 did).
- Learning run 4 (25 Oct): children made as their own type 6 records (43, 44), parent 45 without children, then `children: [{ id }]`: kept. C1 rebuilt that way (parent, children, link, ticket type). Also: a re-run of the round 3 proof re-sent the whole form (compare included display copies), and Halo rewrote every row with new ids. Unchanged form rows are now not sent. Round 5: the builder makes child tickets end to end.
- Learning run 5 (25 Oct): builder made child tickets end to end (template 46, children 47/48, ticket type 70 linked), all verified; the round 3 proof re-ran with nothing to change (form: "nothing to change"). Child tickets switched on.
- Learning run 6 (25 Oct): notifications (5; agent alerts with eventno, delivery_method, agents with roles), priority matrix (rules 14-26: use 1/2, impact/urgency 1-3), categories (105; value = path; sample 261 kept). Found: parent template 46 had Leaver's team "Human Resources" (C2). Built TR3, K1, N1, C2; categories, rule category and notifications held for the round 7 proof.
