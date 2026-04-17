# AR Automation Review

Review date: 2026-04-09

This note summarizes the current functionality and observed risks for the live n8n workflows:

- `AR Automation_Step 1_2025-11-07`
- `AR Automation_Step 2_2026-01-27`

Reference input reviewed:

- `inputs/reference/2026-01-29 Aging AR - Sheet1.csv`

## Workflow Summary

### Step 1

Step 1 accepts a Google Sheets link for the aging A/R source, reads the sheet, groups rows by client, and keeps only clients with at least one project tied to an invoice that is 45 or more days old. It then creates a new Google Sheet for review, places it in the A/R folder, and emails Jared with the review link plus the Step 2 form link.

Using the reference CSV as the model input, Step 1 would effectively process:

- 231 invoice rows
- 59 total clients
- 36 clients selected for follow-up
- 57 projects with at least one 45+ day invoice
- 124 invoice rows aged 45+ days

### Step 2

Step 2 accepts the original aging sheet link and the Step 1 review sheet link. It reads the selected projects from the review sheet, filters the aging data to those projects, groups invoice rows by project and then by client, looks up matching company records in Airtable, and creates Outlook drafts for A/R follow-up. It also sends Jaz an instruction email pointing back to the review sheet.

## Findings

### 1. Outdated hardcoded date language in Step 2 drafts

The active Step 2 draft template contains hardcoded date references such as:

- `Wednesday, February 4th`
- `starting January 1st`

Because the workflow is still active and was last updated on 2026-04-09, those dates are now stale and will produce incorrect timing language in newly generated drafts.

### 2. Negative balances can trigger overdue follow-up selection

Step 1 currently selects follow-up candidates based only on whether `Days Old >= 45`. It does not exclude negative invoice amounts or net credit situations.

In the reviewed aging CSV, the following clients would be selected even though their 45+ day balances are non-positive:

- `TRG Venture Two, LLC`: `-40.00`
- `Core Acquisitions`: `-9280.00`
- `Core Huntley LLC`: `-1141.25`

This means the current workflow can create overdue follow-up drafts for credit-only or non-positive aged balances.

### 3. Google Sheets tab handling is brittle

Step 1 reads the aging sheet using `gid=0`.

Step 2 parses `gid=` from both submitted Google Sheets URLs. If a pasted sheet link does not include a `gid` value, or if the relevant data is not on the expected tab, the workflow may read the wrong tab or fail.

### 4. Recipient handling is weak when Airtable matching is incomplete

Step 2 attempts to match the reviewed client list to Airtable company records and then populate:

- `A/R Emails To`
- `A/R Emails CC`
- `A/R Emails Billing Managers`

If matching fails or those fields are blank, the workflow still carries the client forward and attempts to build a draft payload with empty recipient lists. That creates a weak review gate and can lead to incomplete or unusable drafts.

## Assumptions

- This review is based on the live n8n workflow definitions inspected on 2026-04-09.
- The CSV at `inputs/reference/2026-01-29 Aging AR - Sheet1.csv` was used as the representative source format for the older aging A/R input.
- Manual attachment of invoice PDFs is part of the operating process and is intentionally excluded from the findings in this note.
