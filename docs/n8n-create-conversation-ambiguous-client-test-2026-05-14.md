# n8n Create Conversation Ambiguous Client Test - 2026-05-14

## Scope

This note records the live n8n/Airtable test of `Create New Conversation Record in AirTable - Fuzzy Match Fix` on 2026-05-14.

Workflow:

- Name: `Create New Conversation Record in AirTable - Fuzzy Match Fix`
- n8n ID: `KPPSSE7f0drkxA5L`
- Airtable base: `Jared's CRM` (`appxCuCg2znbMJx2v`)
- Pending confirmation store: n8n data table `Voice Transcript Pending Confirmations` (`3P5UUCp5egiM3Bd4`)
- Telegram test credential used for workflow edits: `G test`

## Test Goal

Workflow 1: Ambiguous Existing Client

Goal: prove the workflow pauses instead of guessing when the voice memo contains a client name that could match multiple Airtable clients.

Expected behavior:

- The bot asks which existing client to use.
- Selecting a client creates exactly one Conversation linked to that client, sends the summary, and marks the pending confirmation resolved.
- Pressing Cancel creates no Conversation and marks the pending confirmation cancelled.

## Test Input

The ambiguous test name was `Miller`.

Live Airtable candidates found during testing:

- Kim Miller - Gallant Building Soluions, confidence `0.91`
- Cam Miller - JE Dunn Construction Group, confidence `0.91`
- Brad Miller - Hutensky Capital Partners, confidence `0.891`

The tested memo content was effectively:

```text
I spoke with Miller about upcoming site planning work and promised to send a short follow-up tomorrow.
```

This is a good ambiguous test because the name alone is not enough to choose one client safely.

## Issue 1: Telegram Buttons Missing

Initial observed behavior:

- Telegram showed the ambiguity prompt text.
- It did not show inline buttons.

Execution inspected:

- Prompt execution: `11577`

Root cause:

- `Build Pending Confirmation` generated `inlineRows`.
- `Ask Telegram Confirmation` had an `inlineKeyboard.rows` array full of empty placeholder rows, so the generated rows were never sent to Telegram.

Fix applied:

- Wired `Ask Telegram Confirmation` to explicit inline row expressions from `Build Pending Confirmation.inlineRows`.
- Kept 5 rows for the conversation workflow:
  - candidate 0
  - candidate 1
  - candidate 2
  - Create new client
  - Cancel
- Ensured Telegram send-message nodes include `resource: message` and `operation: sendMessage`.

Result:

- The next prompt showed buttons in Telegram.

## Issue 2: Duplicate Conversation Records

Observed behavior:

- Pressing Kim Miller created two Conversation records.

Executions inspected:

- Callback execution `11579`
- Callback execution `11580`

Root cause:

- Telegram/n8n delivered two callback executions about 113 ms apart for the same callback payload: `vts:mp5tzn4sp9cg:c0`.
- Both executions read the pending confirmation while its status was still `pending`.
- Both continued to create a Conversation before either one marked the pending row resolved.

Duplicate records observed:

- `recX6RyNSyoI8Kcg9`
- `reci4eAp54NEmQL2z`

Fix applied:

- Added `Claim Pending Confirmation`.
- Candidate/create callback paths now update the pending row from `pending` to `resolving` before any Airtable write.
- Create/summary paths only continue after a successful claim.
- `Mark Confirmation Resolved` now filters for `status = resolving`.

Expected effect:

- A duplicate callback can no longer pass the claim step after the first execution claims the row.

Result:

- Retesting Kim Miller after the claim fix worked: one Conversation was created and the pending confirmation resolved.

## Cancel Flow Result

Execution inspected:

- Prompt execution: `11583`
- Cancel callback execution: `11584`

Observed callback data:

```text
vts:mp5ubr1lz1y6:cancel
```

Execution `11584` behavior:

- `Parse Confirmation Callback` parsed action `cancel`.
- `Get Pending Confirmation` found the row in `pending`.
- `Resolve Pending Choice` returned `resolutionStatus: cancelled`.
- `Send Confirmation Cancelled` sent: `Cancelled. No Airtable record was changed.`
- `Mark Confirmation Cancelled` changed the pending row status to `cancelled`.
- No Airtable create nodes ran.

Conclusion:

- Cancel flow passed. It did not create a Conversation and correctly marked the pending confirmation cancelled.

## Date Problem

Observed issue:

- In execution `11583`, the saved `summaryPayload` had `dateTime: "2024-04-27T00:00:00Z"` even though the memo did not say that date.
- The same payload had `activityType: "call"`, which is not the normalized Airtable value.

Fix applied:

- `Build Source Text` now includes `telegramMessageDate`, derived from the Telegram message timestamp.
- `Extract Conversation Details` now receives explicit timestamp context.
- `Score Fuzzy Match` normalizes `dateTime`:
  - If no explicit date is spoken, use the Telegram message timestamp.
  - If an explicit date is spoken, keep the parsed date when valid.
- `Score Fuzzy Match` normalizes `activityType` to Airtable-friendly choices, defaulting calls/voice memos/audio notes to `Phone Call`.

## Other Workflows Updated

The same confirmation fixes were applied to the current drafts of the summary workflows:

- `Get Lightning Summary from Airtable - Fuzzy Match Fix` (`a1vgvrTQjmzt3qPb`)
- `Get Medium Summary from AirTable - Fuzzy Match Fix` (`faZSYNPHvQinFJz9`)
- `Get Long Form Summary from AirTable - Fuzzy Match Fix` (`ZEqZEE1ZoCTIRTe5`)

Applied draft changes:

- Wired `Ask Telegram Confirmation` to generated `inlineRows`.
- Summary workflows use 4 rows:
  - candidate 0
  - candidate 1
  - candidate 2
  - Cancel
- Added `Claim Pending Confirmation`.
- Added `Mark Claimed Confirmation Expired` for the rare case where a selected client disappears after claim.
- `Mark Confirmation Resolved` now filters for `status = resolving`.
- Telegram send-message nodes include `resource: message` and `operation: sendMessage`.
- `Build Source Text` now preserves `telegramMessageDate` for consistency.

Important publishing note:

- These three summary workflows are active, but their active production versions were not published in this session.
- Their current drafts contain the fixes. Their active versions still use the older placeholder inline keyboard until the drafts are published.

## Validation Notes

- n8n SDK validation passed before each workflow update.
- Updated current draft node counts:
  - Conversation workflow: `37`
  - Lightning summary workflow: `37`
  - Medium summary workflow: `37`
  - Long Form summary workflow: `37`
- Live draft inspection confirmed the summary workflows now have:
  - `currentAskRows: 4`
  - `hasClaim: true`
  - `hasMarkClaimedExpired: true`
  - `resolvedStatus: resolving`

## Remaining Testing

Recommended next tests:

- Conversation workflow: send a fresh ambiguous memo with no explicit date and verify the created Conversation date uses the Telegram message date, not an invented old date.
- Conversation workflow: send a memo with an explicit date and verify the explicit date is respected.
- Summary workflows: test ambiguous client selection in draft/manual mode first.
- Publish active summary workflow drafts only after manual testing passes.
