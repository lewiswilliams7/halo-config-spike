# Instructions for AI coding tools

This repo is a spike testing whether Halo configuration can be created through the Halo REST API from a structured plan.

## Hard rules

- Only ever target the owner's personal Halo trial instance. Never suggest pointing it at an employer or client instance.
- Never add code that deletes anything in Halo.
- All writes go through `haloPost` in `spike/lib/halo.ts`, which enforces the `.env` safety switches. Don't bypass it.
- Never commit `.env`, fixtures or run logs. They contain real instance data.

## How the code is meant to work

- The plan (`spike/plans/*.json`) says what to build. Translators in `spike/lib/translators.ts` turn each step into a Halo payload. This is deterministic code. No AI calls belong in the build path.
- Payloads start from template fixtures captured from real Halo objects, so the shape is Halo's own. Only override what the plan specifies.
- Unknown payload details live in `SPIKE_MAP` as `null`. Fill them from evidence in fixtures, never from guesses, and record the finding in `NOTES.md`.

## Halo rules

`HALO_RULES.md` lists every Halo quirk found so far and the rule that handles it. Read it before changing any translator or the clean step. Every rule there must carry over into the product. When Halo surprises us, add a rule.

## Workflow

Audit first, then implement: read the relevant files and report what you'd change before changing anything.
