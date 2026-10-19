# halo-config-spike

Two-week spike: can Halo configuration (teams, fields, SLAs, approval processes, ticket types) be created reliably through the Halo REST API, in the right order, from a structured plan?

Findings go in [NOTES.md](NOTES.md).

## Rules

- **Your own Halo trial instance only.** Never an employer or client instance, not even read-only.
- **No deletes.** Nothing in this repo deletes anything.
- Writes are refused unless both safety switches are set in `.env`.

## Setup (10 minutes)

1. **Halo trial.** Sign up for a free 30-day trial with your personal email.
2. **API application.** In Halo, go to Configuration → Integrations → Halo API → View Applications → New:
   - Authentication method: **Client ID and Secret (Services)**
   - Login type: **Agent**, logging in as an admin agent
   - Permissions: **all** (for the spike)
   - Note the client ID, secret, and the authorisation server URL.
3. **Install.** Needs Node 20.11 or later.
   ```bash
   npm install
   cp .env.example .env    # then fill it in
   npm run auth            # should print "Token OK" and a team count
   ```

## The spike, per object

```bash
# 1. Build one by hand in the Halo UI, then list and fetch it
npm run get -- TicketType
npm run get -- TicketType 12

# 2. Save it as the template the builder will use
mv spike/fixtures/tickettype-12.json spike/fixtures/template-tickettype.json

# 3. Turn on writes in .env (HALO_ALLOW_WRITES=true, HALO_INSTANCE_LABEL=my-own-trial), then copy it
npm run post -- TicketType fixtures/template-tickettype.json --name "Spike copy"

# 4. Check the copy in the Halo UI. Log works / partial / blocked in NOTES.md
```

Templates are **not** copied by hand any more. Before every build, the builder reads the connected instance and picks one of its own objects of each kind to copy the shape from (`spike/lib/discover.ts`), stored per instance under `spike/fixtures/templates/<host>/`. See what it reads with:

```powershell
npm run scan            # profile of the instance + which templates it will use (read-only)
npm run scan -- --fresh # re-pick templates
```

Every template is deep-cleaned before use (`spike/lib/clean.ts`): copied Halo objects carry nested ids that point at other records, and posting them unchanged can modify existing config.

## The demo

`spike/plans/onboarding.json` is the onboarding request as a plan. `spike/lib/translators.ts` turns each step into a Halo payload, starting from your template fixtures.

```bash
npm run build:onboarding              # dry run: reads only, shows every payload and every gap
npm run build:onboarding -- --apply   # builds it for real, in order, and verifies each object
```

Every `null` in `SPIKE_MAP` (top of `translators.ts`) is an unanswered question. The dry run warns about each one. When the dry run shows no warnings and `--apply` builds a working ticket type, Gate 1's technical half is done.

## Layout

```
spike/
├── lib/halo.ts          auth, GET/POST, safety switches, file helpers
├── lib/translators.ts   plan step → Halo payload; SPIKE_MAP of what's known
├── lib/clean.ts         strips nested ids so a copy can't touch existing records
├── auth.ts              check the API app works
├── get.ts               read any resource, save as fixture
├── post.ts              create a renamed copy of a fixture
├── bundle.ts            merge detail fixtures into one file to share
├── scan.ts              read an instance: profile, data checks, templates
├── lib/discover.ts      pick templates from the connected instance
├── build-onboarding.ts  run a plan in order: reuse, create, verify
├── plans/               plans (committed)
├── fixtures/            real Halo JSON (git-ignored)
└── runs/                run logs (git-ignored)
```
