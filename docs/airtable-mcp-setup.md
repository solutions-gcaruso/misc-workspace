# Airtable MCP Setup

## Current status

Airtable's MCP server is hosted by Airtable. There is no separate local server package to download for this workspace.

- Official MCP server URL: `https://mcp.airtable.com/mcp`
- Airtable support doc: https://support.airtable.com/docs/using-the-airtable-mcp-server

This workspace is prepared for MCP usage with documentation and a cleaned layout, but the final connection still requires you to authenticate from each MCP client you want to use.

## Recommended auth

Prefer OAuth when the client supports it. Otherwise use a Personal Access Token with these scopes:

- `Data.records:read`
- `Data.records:write`
- `schema.bases:read`
- `schema.bases:write`

## ChatGPT / Codex-compatible setup

Use the Airtable MCP endpoint above in the MCP client setup flow for the tool you want to use here.

- Server URL: `https://mcp.airtable.com/mcp`
- Preferred auth: OAuth
- PAT fallback: send `Authorization: Bearer <your-token>`

After setup, validate with read-only steps first:

1. List available bases.
2. Confirm the intended CRM or event base is visible.
3. Inspect schema before attempting create or update actions.

## Claude setup

If you use Claude with PAT auth, Airtable documents this command:

```powershell
claude mcp add --transport http airtable https://mcp.airtable.com/mcp --header "Authorization: Bearer <your personal access token>"
```

If Claude prompts for OAuth details instead, use Airtable's OAuth app flow and the same server URL.

## Airtable org allowlisting

If your Airtable org restricts third-party integrations, an admin may need to allowlist the client integration before MCP works.

- ChatGPT client ID from Airtable docs: `7a713e1a-3d99-4fdf-b59a-311bdf94ba97`
- Claude client ID from Airtable docs: `266cb1c0-b4ae-43a1-b7d7-c2a563667d95`

## Which bases to allow

Limit MCP access to the Airtable bases you actively maintain from Excel in this workspace.

Recommended default:

- CRM base used by `import-airtable-clients`
- event-sync base used by `sync-airtable-event`
- organization event base used by `sync-org-events-from-airtable`

## MCP vs direct API scripts

Use MCP when you want conversational inspection, guided edits, and schema discovery across clients.

Use the existing `.env`-based scripts when you want:

- repeatable dry-run and apply flows
- saved output reports
- spreadsheet-first imports with conservative review queues

Keep both approaches available.
