# Coverage map

What the builder can configure in Halo, ranked by how often real customers ask for it. This is the roadmap, and it's the honest answer when a prospect asks "can it do X?".

**Status:** ✅ proven on a real instance · 🧪 code written, not proven · ⬜ not started · ❌ API can't do it (so far)

Tiers are a first guess from implementation experience. Re-rank them with what pilots actually ask for.

## Tier 1: everyday change requests (needed for pilots)

| Area | Status | Notes |
|---|---|---|
| Custom fields (text, memo, date, dropdown, checkbox) | ✅ | Rules F1–F6. Multi-select untested |
| Ticket types (fields, mandatory, team, SLA, approval, workflow) | ✅ | T1, T2 |
| Statuses | ✅ | |
| Actions (Outcomes) | ✅ | O1, O2. `systemid 0` still to confirm |
| Workflows (copy, add a step and stage) | ✅ | W1, W2. Designer box TBC. Remove/reorder steps not done |
| SLAs (targets per priority) | ✅ | A1. Workdays reused, not created |
| Approval processes: line manager | ✅ | P1 |
| Approval processes: named agent, team, role | ⬜ | **Next** |
| Teams | 🧪 | Reused so far, never created |
| Categories | ⬜ | `POST /Category` exists |
| Priorities | ⬜ | Usually reused |
| Field groups | ⬜ | `POST /FieldGroup` exists |
| Updating existing objects (any of the above) | ✅ | Partial updates proven safe (U0) |

## Tier 2: common, slightly bigger jobs

| Area | Status | Notes |
|---|---|---|
| Email templates | ⬜ | |
| Ticket rules / auto-assignment | ⬜ | |
| Canned text | ⬜ | |
| Escalation and SLA breach notifications | ⬜ | |
| Workdays / business hours | ⬜ | Workday create via REST unconfirmed |
| Service catalogue (services, portal request types) | ⬜ | |
| Agents, roles and permissions | ⬜ | Sensitive: needs extra approval UX |
| Field visibility conditions (show field X when Y) | ⬜ | Seen in fixtures (`group_visibility_conditions`) |
| Workflow edits beyond inserting a step | ⬜ | Remove, reorder, conditions, automations |

## Tier 3: specialist (later, or partner-led)

| Area | Status | Notes |
|---|---|---|
| Runbooks / integrations / automations | ⬜ | |
| Reports and dashboards | ⬜ | Halo already has an AI report builder |
| CMDB / asset types | ⬜ | |
| Contracts, billing, invoicing (PSA) | ⬜ | |
| Portal layout and branding | ⬜ | |
| AI / MCP configuration | ⬜ | |

## Rule for the product

When a request touches anything not ✅, the plan must say so plainly ("I can't build email templates yet") and build only the supported parts, or nothing. Never guess at an unproven area on a customer's instance.
