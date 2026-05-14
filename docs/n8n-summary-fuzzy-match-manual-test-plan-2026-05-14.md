# n8n Summary Fuzzy Match Manual Test Plan - 2026-05-14

## Purpose

Use `Get Lightning Summary from Airtable - Fuzzy Match Fix` as the canonical manual test workflow for the shared summary fuzzy-matching behavior. Once Lightning passes, use the results to update the Medium and Long Form summary workflows, then run the smaller parity smoke tests against those workflows.

Working assumption: the three summary workflows should be functionally identical for input routing, extraction, fuzzy scoring, pending confirmation, callback handling, and no-match behavior. The intentional differences should be limited to:

- `sourceWorkflow` string
- summary field list
- `summaryType` in `summaryPayload`
- Telegram response text and node names for the specific summary type
- workflow IDs, trigger/webhook IDs, and credentials

If a Lightning failure is in matching, confirmation state, callback validation, data-table writes, Telegram button rendering, source text building, or audio routing, treat it as a shared bug and port the same fix to all summary workflows. If the failure is only the returned summary text or Airtable field selection, patch only the affected summary workflow.

## Live Inventory

Summary workflows:

- Lightning: `Get Lightning Summary from Airtable - Fuzzy Match Fix` (`a1vgvrTQjmzt3qPb`)
- Medium: `Get Medium Summary from AirTable - Fuzzy Match Fix` (`faZSYNPHvQinFJz9`)
- Long Form: `Get Long Form Summary from AirTable - Fuzzy Match Fix` (`ZEqZEE1ZoCTIRTe5`)

Shared Airtable base:

- Base: `Jared's CRM` (`appxCuCg2znbMJx2v`)
- Clients table: `tblpwZCI6iGrESUDI`
- Companies table: `tblHPdSrAS7VV8utO`

Shared n8n data table:

- Use current table: `Voice Transcript Pending Confirmations` (`3P5UUCp5egiM3Bd4`)
- Ignore older duplicate unless intentionally testing legacy state: `3kub2d3YownFeYuN`

Summary field mapping:

- Lightning reads `Personal Summary (AI Generated)` and sends `Personal History: ...`
- Medium reads `Personal Summary (AI Generated)` plus `Medium Summary (AI Generated)` and sends `Personal History: ...` plus `Professional Summary: ...`
- Long Form reads `Personal Summary (AI Generated)` plus `Long-Form Summary (AI Generated)` and sends `Personal History: ...` plus `Professional Summary: ...`

Useful live test records observed:

- `Matt Whelan` - `PMAT Real Estate Investments` (`rec00OX4ixecpJFdd`)
- `Alissa Adler` - `Colliers International` (`rec00MwuCs1yf29xC`)
- `Kim Miller` - `Gallant Building Soluions` (`recEE9ogL1aSHlmme`)
- `Cam Miller` - `JE Dunn Construction Group` (`recYSn74uhDvFE8u3`)
- `Brad Miller` - `Hutensky Capital Partners` (`rec237ItQ2jxVIdEh`)

## Pre-Flight Checks

Run these before manual Telegram testing.

1. Confirm the workflow under test is the current draft you intend to test. n8n can have an active production version and a newer unpublished draft. Do not publish unless explicitly approved.
2. Confirm Telegram, OpenAI, Airtable, and n8n data-table credentials are assigned to the test workflow.
3. Confirm the Lightning workflow is pointed at data table `3P5UUCp5egiM3Bd4`, not `3kub2d3YownFeYuN`.
4. Confirm no Airtable create/update/delete nodes exist in the summary workflow. Summary workflows should read Airtable, write n8n pending confirmation state, and send Telegram messages only.
5. Open the n8n executions list and the `Voice Transcript Pending Confirmations` data table so each test can be verified immediately.
6. For each execution, record: test ID, input, execution ID, observed branch, Telegram response, pending-row status, and pass/fail.

## Static Draft Parity Checklist

Before running live messages, inspect the Lightning draft. These are hard requirements.

- `Telegram Trigger` listens for both `message` and `callback_query`.
- `Route Audio Type` has branches for `message.audio.file_id`, `message.voice.file_id`, and text/caption fallback.
- `Build Source Text` preserves `sourceText`, `sourceType`, `telegramChatId`, `telegramMessageId`, `telegramMessageDate`, and a non-empty `transcriptPayload` object when input text exists.
- `Get Pending Confirmation` filters by `confirmationId`, exact `sourceWorkflow`, and `status = pending`.
- `Resolve Pending Choice` rejects invalid callback data, wrong chat IDs, expired rows, unavailable candidate indexes, and unsupported `create` actions.
- `Claim Pending Confirmation` exists and changes the row from `pending` to `resolving` before any confirmed summary is sent.
- `Mark Confirmation Resolved` filters on `status = resolving`.
- `Mark Confirmation Cancelled` filters on `status = pending`.
- `Mark Claimed Confirmation Expired` exists for the case where the selected Airtable client disappears after claim.
- `Ask Telegram Confirmation` uses generated inline rows from `Build Pending Confirmation`; the Telegram prompt must show candidate buttons plus `Cancel`.
- `Build Pending Confirmation` writes meaningful `transcriptPayload`, `summaryPayload`, and `candidatePayload`.

Stop and fix parity issues before live testing.

## Lightning Manual Test Workflows

### L1 - Exact Text Auto-Match

Input:

```text
Get the lightning summary for Matt Whelan at PMAT Real Estate Investments.
```

Expected:

- Routes through text fallback, not audio transcription.
- Extracts `Matt Whelan` and company.
- `Score Fuzzy Match` returns `matchStatus = auto_match`.
- No pending confirmation row is created.
- Telegram sends exactly one Lightning response using `Personal Summary (AI Generated)`.
- No Airtable writes occur.

### L2 - Typo Text Auto-Match

Input:

```text
Get the lightning summary for Mat Whelan at PMAT Real Estate Investments.
```

Expected:

- Fuzzy score still auto-matches to `Matt Whelan`.
- No confirmation prompt appears.
- Response text is the same field family as L1.
- Record `matchConfidence`, `matchDelta`, and top candidate in the execution notes.

Repeat with:

```text
Get the lightning summary for Alysa Adler at Colliers International.
```

Expected match: `Alissa Adler`.

### L3 - Exact Name Without Company

Input:

```text
Get the lightning summary for Alissa Adler.
```

Expected:

- Auto-matches if the name is unique enough.
- If it asks for confirmation because the live data is ambiguous, that is acceptable only if the candidates are relevant and the workflow does not guess.
- It must not route to `not_found` for a clear existing full name.

### L4 - Ambiguous Last Name Confirmation

Input:

```text
I spoke with Miller about upcoming site planning work and promised to send a short follow-up tomorrow. Get the lightning summary.
```

Expected:

- Routes to `needs_confirmation`.
- Telegram prompt says it heard `Miller` or a close extracted name.
- Prompt shows up to three candidate buttons plus `Cancel`.
- Expected candidate family includes relevant Miller records such as `Kim Miller`, `Cam Miller`, and/or `Brad Miller`.
- Data table row is created with `status = pending`.
- `candidatePayload` is valid JSON and contains the same choices as the buttons.
- `transcriptPayload` includes source text, source type, Telegram metadata, extracted client/company, match status, confidence, and delta.
- `summaryPayload` includes `summaryType = lightning` and requested field `Personal Summary (AI Generated)`.
- No summary is sent before a button is selected.

### L5 - Ambiguous Candidate Selection

Prerequisite: use the pending prompt from L4.

Action:

- Press the `Kim Miller - Gallant Building Soluions` button if present. If not present, pick the top intended candidate and record which one.

Expected:

- Pending row transitions `pending -> resolving -> resolved`.
- Telegram sends exactly one Lightning response for the selected Airtable client.
- The selected client ID in the execution matches the selected candidate from `candidatePayload`.
- No second summary is sent.
- No Airtable records are created or updated.

### L6 - Duplicate/Stale Button Guard

Prerequisite: complete L5.

Action:

- Press the same candidate button again, or double-tap quickly during a fresh ambiguous test.

Expected:

- Second callback does not send a second summary.
- Second execution either cannot find a pending row or routes to a user-facing problem message.
- The pending row remains `resolved`; it must not revert to `pending`.

### L7 - Cancel Confirmation

Input:

```text
I spoke with Miller about a new planning follow-up. Get the lightning summary.
```

Action:

- Press `Cancel`.

Expected:

- Telegram sends `Cancelled. No Airtable record was changed.` or equivalent.
- Pending row changes from `pending` to `cancelled`.
- No summary is sent.
- No Airtable writes occur.

### L8 - Expired Confirmation

Input:

```text
I spoke with Miller about a site planning update. Get the lightning summary.
```

Action:

- After the prompt appears, either wait more than 60 minutes or manually adjust the pending row `createdTime` to more than 60 minutes ago in the test data table.
- Press a candidate button.

Expected:

- Telegram sends an expiration message.
- Pending row changes to `expired`.
- No summary is sent.
- No Airtable writes occur.

### L9 - Not Found

Input:

```text
Get the lightning summary for Zanthar Quibble at Star Forge.
```

Expected:

- Routes to `not_found`.
- Telegram says it could not find an existing Airtable client for the extracted name.
- No pending confirmation row is created.
- No Airtable writes occur.

### L10 - Voice Memo

Action:

- Send a Telegram voice memo saying:

```text
Get the lightning summary for Matt Whelan at PMAT Real Estate Investments.
```

Expected:

- Routes through `Get Voice Memo File`, `Merge Audio Inputs`, and `Transcribe a recording`.
- `Build Source Text` reports `sourceType = voice`.
- Transcription text contains the intended request closely enough for extraction.
- Ends in the same expected result as L1.

### L11 - Uploaded Audio File

Action:

- Upload an audio file, not a Telegram voice memo, containing:

```text
Get the lightning summary for Alissa Adler at Colliers International.
```

Expected:

- Routes through `Get Audio File`, `Merge Audio Inputs`, and `Transcribe a recording`.
- `Build Source Text` reports `sourceType = audio`.
- Ends in the same expected result as L1/L2.

### L12 - Caption/Text Fallback

Action:

- Send a non-audio Telegram message with a caption:

```text
Get the lightning summary for Matt Whelan at PMAT Real Estate Investments.
```

Expected:

- Routes through the text/caption fallback branch.
- Does not attempt to download/transcribe media.
- Ends in the same expected result as L1.

### L13 - Empty Or Unsupported Message

Action:

- Send a sticker, image, or file with no caption.

Expected:

- Workflow does not crash.
- It should route to not-found or a user-facing problem message.
- No pending row is created unless a meaningful candidate list exists.
- No Airtable writes occur.

### L14 - Wrong-Chat Guard

This is optional because it requires a second Telegram chat or group.

Action:

- Create a pending confirmation in one chat.
- Trigger the same callback from another chat if the Telegram UI allows it, or reproduce the callback payload in a controlled manual execution.

Expected:

- `Resolve Pending Choice` rejects the callback.
- Telegram says the confirmation belongs to another chat.
- The original pending row remains pending or expires normally.
- No summary is sent to the wrong chat.

### L15 - Company-Assisted Candidate Ordering

Input:

```text
Get the lightning summary for Miller. The company is Gallant Building Soluions and the topic is site planning.
```

Expected:

- The workflow should not auto-match solely because the company is strong when the name is ambiguous.
- The prompt should prioritize same-company candidates, especially `Kim Miller`, ahead of unrelated Millers.
- Other plausible Millers may still appear as backup candidates.
- `companyBonus` should remain small and should not saturate `matchConfidence` to `1.0`.

### L16 - Company Mention Recovery

Input:

```text
I need the lightning summary for Kim. We were talking about Gallant Building Soluions and upcoming site planning work.
```

Expected:

- If the extractor returns the company directly, that is fine.
- If the extractor omits the company, `Score Fuzzy Match` should recover it from the transcript text or still produce a safe confirmation.
- The workflow should prefer relevant Gallant candidates.
- It should not auto-match to a weak name-only match unless the score and delta thresholds are met.

## Medium And Long Form Parity Smoke Tests

Run these only after Lightning passes and any shared fixes have been copied to Medium and Long Form.

### M1 - Medium Exact Text Auto-Match

Input:

```text
Get the medium summary for Matt Whelan at PMAT Real Estate Investments.
```

Expected:

- Same routing and match behavior as L1.
- Telegram response includes `Personal History:` and `Professional Summary:`.
- `Professional Summary:` uses `Medium Summary (AI Generated)`.
- `summaryPayload.summaryType = medium`.
- `summaryPayload.requestedFields` includes `Personal Summary (AI Generated)` and `Medium Summary (AI Generated)`.

### M2 - Medium Ambiguous Select

Input:

```text
I spoke with Miller about upcoming site planning work. Get the medium summary.
```

Expected:

- Same confirmation, selection, claim, and resolve behavior as L4/L5.
- Returned summary uses Medium fields.
- Pending row `sourceWorkflow` is exactly `Get Medium Summary from AirTable - Fuzzy Match Fix`.

### M3 - Medium Cancel

Run the Miller ambiguous prompt again and press `Cancel`.

Expected:

- Same behavior as L7.

### G1 - Long Form Exact Text Auto-Match

Input:

```text
Get the long form summary for Matt Whelan at PMAT Real Estate Investments.
```

Expected:

- Same routing and match behavior as L1.
- Telegram response includes `Personal History:` and `Professional Summary:`.
- `Professional Summary:` uses `Long-Form Summary (AI Generated)`.
- `summaryPayload.summaryType = long_form`.
- `summaryPayload.requestedFields` includes `Personal Summary (AI Generated)` and `Long-Form Summary (AI Generated)`.

### G2 - Long Form Ambiguous Select

Input:

```text
I spoke with Miller about upcoming site planning work. Get the long form summary.
```

Expected:

- Same confirmation, selection, claim, and resolve behavior as L4/L5.
- Returned summary uses Long Form fields.
- Pending row `sourceWorkflow` is exactly `Get Long Form Summary from AirTable - Fuzzy Match Fix`.

### G3 - Long Form Cancel

Run the Miller ambiguous prompt again and press `Cancel`.

Expected:

- Same behavior as L7.

## Acceptance Gate

Treat the workflows as ready only when all of these are true:

- Lightning passes L1 through L13.
- L14 passes if a second-chat test is available.
- L15 and L16 show company context helps ordering but does not force unsafe auto-matches.
- Medium passes M1 through M3 after shared fixes are copied.
- Long Form passes G1 through G3 after shared fixes are copied.
- No summary workflow creates or updates Airtable records.
- The only write side effects are n8n data-table pending confirmation rows and Telegram messages.
- Every ambiguous request either prompts for confirmation or safely reports not found.
- Every selected confirmation sends one summary and resolves one pending row.
- Cancel, expired, invalid, stale, and duplicate callbacks do not send summaries.

## Edit Guidance From Test Results

- Matching bug: patch `Score Fuzzy Match` in Lightning, then port the same code to Medium and Long Form.
- Prompt/button bug: patch `Build Pending Confirmation` or `Ask Telegram Confirmation` in all three.
- Callback bug: patch `Parse Confirmation Callback`, `Get Pending Confirmation`, `Resolve Pending Choice`, `Claim Pending Confirmation`, and status-marking nodes in all three.
- Payload bug: patch `Build Source Text` and `Build Pending Confirmation` in all three, preserving workflow-specific `summaryType` and requested fields.
- Summary field bug: patch only the relevant `Send ... Summary`, `Send Confirmed ... Summary`, and workflow-specific `summaryPayload`.
- Publishing bug: do not publish until the current draft passes manual tests and the user approves publication.
