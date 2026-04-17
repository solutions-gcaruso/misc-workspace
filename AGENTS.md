# AGENTS.md

## Purpose

This repository is a Node-based Airtable and Excel automation workspace. Most tasks fall into one of these buckets:

- inspect or update Airtable-backed workflows
- ingest spreadsheets from `inputs/active/`
- generate review queues and output reports
- maintain import, sync, enrichment, and personalization scripts in `src/scripts/`

Optimize for conservative, low-risk changes. Prefer dry runs, clear summaries, and preserving current data flows over clever refactors.

## Repo shape

- `src/scripts/`: task entrypoints and CLI flows
- `src/lib/`: reusable Airtable, workbook, matching, scraping, and reporting logic
- `src/test/`: Node test coverage
- `config/`: runtime JSON config and override files
- `inputs/active/`: live source spreadsheets for current workflows
- `inputs/reference/`: supporting workbook sets and lookup material
- `output/`: rebuildable generated artifacts only
- `docs/`: setup notes and operating guidance
- `review/`: uncertain files or notes awaiting classification

## Working rules

- Treat `output/` as disposable and rebuildable.
- Keep new raw spreadsheets in `inputs/active/`, not the repo root.
- Put one-off notes or uncertain legacy material in `review/`.
- Keep the existing `.env`-driven Airtable API script path working even if MCP is also available.
- Do not hardcode secrets into repo-tracked files.
- Prefer minimal, targeted changes over broad rewrites.

## Execution norms

- Default to dry-run behavior first. Only use apply-mode flows when the task explicitly requires writes.
- Always run a dry run first to validate functionality before any apply-mode execution, even when the end goal is a live Airtable update.
- For attendee-to-Airtable event tagging requests, make this the standard workflow:
  - confirm the exact source file and exact tag/event value with the user before running anything
  - run a dry run first and review the generated summary and review queue
  - treat ambiguous or low-confidence matches as review-only by default and do not update them automatically
  - pause for user approval after the dry run before any apply-mode Airtable writes
- Before changing any import or sync behavior, inspect the relevant script in `src/scripts/` and the helper modules it calls in `src/lib/`.
- When touching Airtable update flows, preserve the current safety posture:
  - validate env vars
  - generate summary/report output
  - avoid duplicate tagging or duplicate record creation
  - keep review queues for ambiguous matches
- Preserve CLI flags and default file locations unless the task explicitly changes them.

## Common commands

```powershell
npm test
npm run sync:event:dry
npm run sync:event:apply
npm run import:clients:dry
npm run import:clients:apply
npm run org-events:dry
npm run org-events:apply
```

## MCP usage

This workspace may have MCP servers configured for Airtable and n8n.

- Use Airtable MCP when the task needs live schema inspection, record lookup, or guided Airtable changes.
- Use n8n MCP when the task needs live workflow inspection or workflow edits.
- If live system state matters, say so explicitly in the work:
  - use MCP, not local guesses
  - inspect live schema before writes
  - inspect live n8n workflows before changing automation assumptions
- Do not remove or replace the existing `.env` script flows just because MCP exists.

## Editing guidance

- Keep code style consistent with the existing CommonJS Node scripts.
- Add small helper functions instead of making `main()` flows harder to read.
- Prefer explicit error messages for missing args or env vars.
- Keep report generation and summary output intact when modifying workflows.
- Add or update tests when behavior changes in `src/lib/` or script argument parsing.

## Validation

- Run targeted tests for touched areas when possible.
- For script changes, prefer validating with the corresponding dry-run command before considering apply-mode behavior.
- If a change affects file outputs, verify the expected artifacts land in `output/`.

## Agent behavior

- Read the relevant script and helpers before editing.
- Make the smallest safe change that satisfies the request.
- Call out assumptions around Airtable schema, spreadsheet shape, and MCP availability.
- Surface any risk that could cause unintended Airtable writes, record duplication, or workflow regressions.
