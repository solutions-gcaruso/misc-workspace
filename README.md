# Airtable and Excel Automation Workspace

Node-based scripts for Airtable sync, spreadsheet ingestion, attendee enrichment, and report generation.

## What lives here

- `src/scripts/`: CLI entrypoints for sync, import, enrichment, and generation flows
- `src/lib/`: reusable Airtable, workbook, matching, scraping, and reporting helpers
- `src/test/`: Node test coverage
- `config/`: runtime config and example override files
- `docs/`: setup notes and workflow guidance

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

## Notes

- `.env`, `node_modules/`, generated `output/`, and local spreadsheet/config data are gitignored.
- This repo is set up to favor dry runs and conservative Airtable updates.
