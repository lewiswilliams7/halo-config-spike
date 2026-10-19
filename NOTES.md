# Spike notes

Goal: prove every v1 object can be created through the Halo API and works correctly in the UI.
Gate 1 passes when every row below is **works** (or the object is dropped from v1).

Halo version tested: \_\_\_ · Trial instance: \_\_\_ · Dates: \_\_\_

## Results per object

Method for each row: build one by hand in the UI → `npm run get -- <Resource> <id>` → rename to `fixtures/template-<resource>.json` → `npm run post -- <Resource> <fixture> --name "Spike copy"` → check it in the UI.

| Object | Endpoint | GET works | POST creates | Correct in UI | Result | Payload notes |
| --- | --- | --- | --- | --- | --- | --- |
| Team | `/Team` | | | | | |
| Status | `/Status` | | | | | |
| Priority | `/Priority` | | | | | |
| SLA | `/SLA` | | | | | |
| Custom field | `/Field`, `/FieldInfo` | | | | | |
| Field group | `/FieldGroup` | | | | | |
| Category | `/Category` | | | | | |
| Approval process | `/ApprovalProcess` | | | | | |
| Approval rule | `/ApprovalProcessRule` | | | | | |
| Ticket type | `/TicketType` | | | | | |
| Workflow (v2, look only) | `/Workflow` | | | | | |

Result = **works** / **partial** / **blocked**.

## Open questions

- [ ] Can fields be attached to a ticket type, and made mandatory, through `POST /TicketType`? Which properties?
- [ ] Field type codes: which value means text, memo, date, dropdown, checkbox?
- [ ] Dropdown options: inline on the field, or a separate lookup?
- [ ] SLA targets: stored in days, hours or minutes? Which property?
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
