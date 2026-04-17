# MCP Usage Cheat Sheet

This workspace has two MCP servers configured for conversational use:

- `airtable`
- `n8n-mcp`

Claude and Codex can choose these tools automatically when your request clearly calls for them, but the most reliable pattern is to say which MCP you want used.

## Quick rule

Use prompts like:

- `Use the Airtable MCP to ...`
- `Use the n8n MCP to ...`

That removes ambiguity and makes tool choice more predictable.

## Airtable MCP prompts

Use Airtable MCP for schema discovery, record lookup, safe inspection, and guided updates.

- `Use the Airtable MCP to list the bases I can access.`
- `Use the Airtable MCP to inspect the schema for the CRM base.`
- `Use the Airtable MCP to show me the fields on the contacts table before we change anything.`
- `Use the Airtable MCP to find records matching this company name: <name>.`
- `Use the Airtable MCP to confirm whether this event field already exists.`
- `Use the Airtable MCP to compare the table schema against the spreadsheet columns I am importing.`
- `Use the Airtable MCP read-only first, then tell me what update you would make.`

## n8n MCP prompts

Use n8n MCP for workflow discovery, workflow inspection, and building or updating workflows with n8n-aware tooling.

- `Use the n8n MCP to list the workflows available in my instance.`
- `Use the n8n MCP to find workflows related to Airtable sync.`
- `Use the n8n MCP to inspect the nodes in the workflow for lead intake.`
- `Use the n8n MCP to explain what this workflow does step by step.`
- `Use the n8n MCP to draft a workflow that takes Airtable updates and sends notifications.`
- `Use the n8n MCP to find any workflow that touches this table or base name: <name>.`
- `Use the n8n MCP to review a workflow for likely failure points before we edit it.`

## Combined prompts

These are useful when work spans both systems.

- `Use Airtable MCP and n8n MCP to map which workflows depend on this Airtable base.`
- `Use Airtable MCP to inspect the schema, then use n8n MCP to check whether any workflows depend on those fields.`
- `Use n8n MCP to find the workflow, then use Airtable MCP to verify the destination table structure.`
- `Use both MCP servers to trace how a spreadsheet import ends up in Airtable and where automation runs afterward.`

## When MCP may not be used automatically

The model may skip MCP if your request is mostly:

- writing or brainstorming
- local code edits
- docs work
- general planning without needing live system data

If the live system matters, say so directly:

- `Use MCP, not just local files.`
- `Check this in Airtable live before answering.`
- `Inspect the live n8n workflow instead of guessing from code.`

## Good safety habits

- Start with read-only prompts before asking for updates.
- Ask for schema inspection before record writes.
- Ask for a summary of planned changes before applying edits.
- Be explicit when you want live data from Airtable or n8n rather than guesses from local files.
