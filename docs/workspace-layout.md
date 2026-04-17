# Workspace Layout

This workspace is now organized around active Airtable and Excel automation work.

## Active areas

- `src/`: application code and tests
- `config/`: runtime config files used by the scripts
- `inputs/active/`: source spreadsheets that feed Airtable workflows
- `inputs/reference/`: supporting workbook sets kept for lookup or secondary workflows
- `output/`: disposable run output only
- `docs/`: setup notes and operating docs
- `review/`: items waiting for a keep/delete/archive decision

## Working rules

- Treat `output/` as rebuildable. Delete its contents freely between runs.
- Keep new raw spreadsheets in `inputs/active/`, not at the repo root.
- Put one-off notes, experiments, or uncertain legacy files in `review/` until they are classified.
- Keep direct Airtable API scripts working from `.env`; do not remove that path just because MCP is available.

## Common commands

```powershell
npm install
npm test
npm run sync:event:dry
npm run import:clients:dry
```
