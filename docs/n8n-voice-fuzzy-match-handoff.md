# Codex Session Handoff: n8n Voice Fuzzy Match Workflows

Use this prompt in a new Codex session to write a remediation plan before making more n8n workflow edits.

```text
You are Codex working in `c:\Users\gcaruso\Misc Workspace`.

Read `AGENTS.md` first. This workspace uses MCP for live Airtable and n8n inspection. Live system state matters for this task, so use n8n MCP and Airtable MCP rather than guessing from local files.

Context:

We were asked to improve voice-transcript fuzzy matching for n8n workflows that read Telegram voice memos/audio recordings, transcribe them, extract a person's name/company, match that against Airtable CRM clients, and either return summaries or create a conversation record.

The original workflows should remain untouched as archives. Four new replacement draft workflows were created with the original names plus ` - Fuzzy Match Fix`:

- `Get Lightning Summary from Airtable - Fuzzy Match Fix`
  - Workflow ID: `1RMHtit102t9Gvm9`
- `Get Medium Summary from AirTable - Fuzzy Match Fix`
  - Workflow ID: `Zjmm0qSWijeXg17v`
- `Get Long Form Summary from AirTable - Fuzzy Match Fix`
  - Workflow ID: `IPz7E96nudrJd9iR`
- `Create New Conversation Record in AirTable - Fuzzy Match Fix`
  - Workflow ID: `qWjNJMdcx6l6JQZH`

Two earlier incorrect drafts were archived:

- `Voice Transcript Fuzzy Match Resolver`
- `Get Medium Summary from Airtable V2 - Fuzzy Gate`

An n8n Data Table was created for pending confirmation state:

- Name: `Voice Transcript Pending Confirmations`
- ID: `3kub2d3YownFeYuN`
- Project ID: `Hf3RDDvgLtc3PukY`
- Columns:
  - `confirmationId`
  - `telegramChatId`
  - `sourceWorkflow`
  - `transcriptPayload`
  - `summaryPayload`
  - `candidatePayload`
  - `createdTime`
  - `status`

Current implementation summary:

- The new workflows are inactive drafts.
- Credentials were not auto-assigned by n8n when the workflows were created. The user must select existing Telegram/OpenAI/Airtable credentials in the n8n UI before activation or live testing.
- Voice memo input shape `message.voice.file_id` and audio/file input shape `message.audio.file_id` are both accounted for.
- Summary workflows support text-style input fallback.
- The fuzzy match code reads live Airtable `Clients` records and, for summary workflows, also reads `Companies`.
- Matching uses normalized names, token similarity, edit-distance similarity, phonetic scoring in the summary workflows, last-name boost, and company boost.
- Ambiguous matches write a row to the n8n Data Table and send an inline Telegram confirmation message in the same chat.
- Callback confirmation resumes via the same workflow, reads the pending row, selects the chosen candidate, and continues.

Testing already performed:

A subagent used n8n MCP pinned payload testing. Nothing was published or activated. Risky Telegram/Data Table/Airtable write nodes were pinned when exercised.

Passed in pinned tests:

- Text-style summary request routed correctly.
- Telegram voice memo shape `message.voice.file_id` routed correctly.
- Telegram audio file shape `message.audio.file_id` routed correctly.
- Auto-match path worked for close spelling examples:
  - `Alyssa/Alysa Adler` -> `Alissa Adler`
  - `Mat Whelan` -> `Matt Whelan`
- No-match path worked:
  - `Zanthar Quibble / Star Forge` routed to `Send Not Found`
- Ambiguous path worked:
  - same-company `Tim Johnson / Timothy Johnson / Tom Johnston` routed to Telegram confirmation
- Callback confirmation path worked:
  - summary confirmation resolved selected client and marked pending row resolved
  - conversation confirmation resolved selected client and reached a pinned conversation-create path

Known problems that need a plan:

1. Company boost is too strong.
   - Scores can saturate at `1.0` when a company is included.
   - In the ambiguous test, `Tim Johnson` and `Tom Johnston` both scored `1.0`.
   - Same-company ambiguity prevented a bad auto-match in that test, but the scoring is still too risky.
   - Plan should propose a cap or weighting adjustment so company helps disambiguate but cannot overpower weak name confidence.

2. Confirmation UI is incomplete.
   - Inline buttons only include the top candidate choices.
   - The original plan called for:
     - top 2-3 candidates
     - `Create new client`
     - `Cancel`
   - Plan should decide whether to implement `Create new client` now or remove that option from UX until supported.

3. Callback handling is not defensive enough.
   - Callback parsing assumes data shaped like `vts:<confirmationId>:c<index>`.
   - It does not safely handle invalid callback data, missing candidate index, `Cancel`, or `Create new client`.
   - Plan should include validation and user-facing failure messages.

4. Pending confirmation lookup is too broad.
   - Current lookup filters only by `confirmationId`.
   - It should filter by:
     - `confirmationId`
     - `sourceWorkflow`
     - `status = pending`
   - Plan should also consider whether to validate `telegramChatId` from the callback against the stored row.

5. Pending state does not preserve enough context.
   - Summary workflows currently store `{}` for `transcriptPayload` and `summaryPayload`.
   - This means the pending table does not preserve full transcription/extraction context.
   - Plan should specify exactly what payloads to store for summary workflows and conversation workflow.

6. Conversation workflow does not implement new-client/company fallback.
   - Current behavior supports existing/confirmed client matching and same-chat Telegram confirmation.
   - It does not create a new client under a matched company when no client confidently matches.
   - Plan should either implement that fallback or explicitly scope it out and keep `Create new client` hidden.

7. Real end-to-end testing is still pending.
   - Real unpinned testing was not run because it could send Telegram messages, query OpenAI, and create Airtable records.
   - Plan should include a staged testing approach:
     - static workflow inspection
     - pinned unit-style route tests
     - read-only fuzzy harness against live Airtable clients
     - controlled manual Telegram tests after credentials are assigned
     - safe test Airtable writes only if explicitly approved

Important constraints:

- Do not publish or activate workflows without explicit user approval.
- Do not modify the original non-`Fuzzy Match Fix` workflows unless explicitly requested.
- Do not make live Airtable writes unless the user explicitly approves after a dry run/test plan.
- Do not hardcode secrets into repo files.
- Use MCP to inspect live n8n workflow details and live Airtable schema before planning changes.
- Prefer a plan first. The user asked this handoff prompt to guide Codex to write a plan to solve the problems, not to immediately implement.

Task:

Inspect the four `- Fuzzy Match Fix` workflows using n8n MCP and inspect relevant Airtable schema/data using Airtable MCP. Then write a concrete remediation plan to address the seven known problems above. The plan should identify:

- exact workflow/node areas to change
- matching-score adjustments
- callback and pending-state hardening
- Data Table payload changes
- whether to include or defer new-client/company creation
- a safe test strategy that avoids accidental Telegram sends or Airtable writes
- activation prerequisites

Do not implement until the user approves the plan.
```

