# Coverage map

What the builder can configure in Halo, ranked by how often real customers ask for it. This is the roadmap, and it's the honest answer when a prospect asks "can it do X?".

**Status:** ✅ proven on a real instance · 🧪 code written, not proven · 🔒 code written, switched off until a capture fills its gaps (B2) · ⬜ not started · ❌ API can't do it (so far)

Tiers are a first guess from implementation experience. Re-rank them with what pilots actually ask for.

## Tier 1: everyday change requests (needed for pilots)

| Area | Status | Notes |
|---|---|---|
| Custom fields (text, memo, date, dropdown) | ✅ | Rules F1–F6 |
| Custom fields (checkbox, multi-select) | 🧪 | `plans/tier1-test.json` |
| Ticket types (fields, mandatory, team, SLA, approval, workflow) | ✅ | T1, T2 |
| Statuses | ✅ | |
| Actions (Outcomes) | ✅ | O1, O2. `systemid 0` still to confirm |
| Workflows (copy, add a step and stage) | ✅ | W1, W2. Designer shows new steps |
| Workflows: several new steps in a chain | 🧪 | `insert_steps` |
| SLAs (one target for all priorities) | ✅ | A1. Workdays reused, not created |
| SLAs: different target per priority | 🧪 | `targets: {"Critical": "4h"}` |
| Approval processes: line manager | ✅ | P1 |
| Approval processes: named agent, approval group, multi-stage | ✅ | P1–P4. Ad-hoc untested; roles not mapped; line manager needs managers set (P4) |
| Approval groups (CABs) | 🧪 | Reuse ✅; create with members coded (M1), `plans/tier1-test.json` |
| Teams | 🧪 | Reuse ✅; create with members coded (M1), `plans/tier1-test.json` |
| Categories | 🔒 | K1. Built; switched on once learn round 7 proves a multi-level path |
| Priorities | ⬜ | Usually reused |
| Field groups | 🧪 | Create + attach to ticket type coded (M1), `plans/tier1-test.json` |
| Updating existing objects (any of the above) | ✅ | Partial updates proven safe (U0) |

## Tier 2: common, slightly bigger jobs

| Area | Status | Notes |
|---|---|---|
| Email templates, and emails sent from an action | ✅ | E1, O4. Built by the builder on gethandoveruk (template -103, action 107), read back exactly. Delivery to be seen in the UI. Emails on events (notifications): ⬜ |
| Ticket rules: route to a team or agent, set a priority, on ticket type and answers | ✅ | TR1, TR2. Rule 28 built and read back (requesttypenew + dropdown criteria, team, priority 2, nothing else) |
| Child tickets raised when a ticket is logged | ✅ | C1. Builder made template 46 (children 47, 48) and linked ticket type 70 on gethandoveruk. Raising them on a real ticket to be seen in the UI. In order / on approval: ⬜ |
| Canned text | ⬜ | |
| Agent notifications on events | 🔒 | N1. Built for 5 events; switched on once learn round 7 proves a subscription. SLA breach events: ⬜ |
| Priority matrix (impact x urgency) | 🧪 | TR3. Switched on; learn round 7 builds a matrix rule |
| Workdays / business hours | ⬜ | Workday create via REST unconfirmed |
| Service catalogue (services, portal request types) | ⬜ | |
| Agents, roles and permissions | ⬜ | Sensitive: needs extra approval UX |
| Show a field only for some answers | ✅ | V1. Field 366 on Software Licensing Request, condition read back in Halo's shape. Sections: 🔒 (shape not understood) |
| Workflow edits beyond inserting a step | ⬜ | Remove, reorder, conditions, automations |

## Tier 3: specialist (later, or partner-led)

| Area | Status | Notes |
|---|---|---|
| Runbooks / integrations / automations | 🔒 | Read: runbooks are Webhook records (event triggers, flowchart steps like workflows). Not built: no runbook made by hand to learn from yet |
| Reports and dashboards | ⬜ | Halo already has an AI report builder |
| CMDB / asset types | ⬜ | |
| Contracts, billing, invoicing (PSA) | ⬜ | |
| Portal layout and branding | ⬜ | |
| AI / MCP configuration | ⬜ | |

## The AI planner

| Capability | Status | Notes |
|---|---|---|
| Plain English → plan in the builder's format | 🧪 | `npm run plan`; validation + one retry proven with a faulty fake reply |
| Says what it can't build (`unsupported`) instead of guessing | 🧪 | Tested by `prompts/enterprise-jml.txt` |
| Uses the instance inventory (reuse real names, real workflow steps) | 🧪 | |

## Reading the customer's instance

| Capability | Status | Notes |
|---|---|---|
| Profile: what exists (types, fields, workflows, people…) | 🧪 | `npm run scan` |
| Templates picked from the instance itself, per instance | 🧪 | D1, D2 (`lib/discover.ts`). Test B proves it on a fresh trial |
| Find existing objects by name before reusing/updating | ✅ | Pre-flight (S7, S8) |

## Pre-build checks (the "consultant" layer)

Before building, check the customer's own data can support the plan, and suggest a fix when it can't.

| Check | Why | Status |
|---|---|---|
| Line-manager approval → how many users have no manager? | Their approvals error (P4) | 🧪 in `scan`, needs the real Users manager field confirmed |
| Named agent / group approver → do they exist and are they active? | Approvals go nowhere | 🧪 pre-flight finds them |
| New field name → clashes with an existing field? | Confusing duplicates | ⬜ |

## Rule for the product

When a request touches anything not ✅, the plan must say so plainly ("I can't build email templates yet") and build only the supported parts, or nothing. Never guess at an unproven area on a customer's instance.
