# Org Events Scraper

## Purpose

This workflow reads organizations from Airtable, scrapes each organization's `Source URL`, enriches events from detail pages when available, and then creates or updates records in the Airtable `Events` table.

## Commands

```powershell
npm run org-events:dry
npm run org-events:apply
```

Optional flags:

```powershell
npm run org-events:dry -- --limit 3
npm run org-events:dry -- --org "NAIOP"
```

## Required env vars

- `AIRTABLE_API_KEY`
- `ORG_EVENTS_BASE_ID`
- `ORG_EVENTS_ORGS_TABLE`
- `ORG_EVENTS_EVENTS_TABLE`
- `ORG_EVENTS_TIMEZONE`

## Output files

- `output/org-events-summary.json`
- `output/org-events-review.csv`
- `output/org-events-scraped.json`
- `output/org-events-audit-preview.json`
- `output/org-events-updates-preview.json`
- `output/org-events-deletes-preview.json`

## Safety

- Dry run is the default.
- Apply mode only writes confident creates and updates.
- The workflow also audits and removes clearly invalid event records such as sponsor pages, generic event-list pages, attendee subpages, and other known false positives.
- After the audit step, the workflow removes events whose `Event Date` is already in the past.
- Ambiguous matches or conflicting scraped values go to the review CSV instead of being written automatically.
