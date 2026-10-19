# @pdfshush/mcp

Local stdio MCP server that runs PDFShush tools through the public `/api/v1`
REST API with **your own API key**. It ships no PDF engine and touches no
disk: every tool call is a submit → poll → download against the deployment
you point it at, inside the same quota, janitor and admission-control
pipeline the web app uses.

## Config

Two environment variables:

- `PDFSHUSH_API_KEY` — a `pshk_…` key from the account dashboard. Required;
  without it the server exits with instructions.
- `PDFSHUSH_API_URL` — the deployment root (default `https://api.pdfshush.com`).
  Plain http is refused unless the host is loopback or you set
  `PDFSHUSH_ALLOW_HTTP=1` explicitly (your key travels on the wire unencrypted).

## Claude Desktop / any MCP client

```json
{
  "mcpServers": {
    "pdfshush": {
      "command": "npx",
      "args": ["-y", "@pdfshush/mcp"],
      "env": {
        "PDFSHUSH_API_URL": "https://your-deployment.example.com",
        "PDFSHUSH_API_KEY": "pshk_…"
      }
    }
  }
}
```

## Surface

- One tool per server-runnable slug (`pdfshush_inspect`, `pdfshush_merge`,
  `pdfshush_organize`, `pdfshush_stamp`, `pdfshush_split_by_pages`,
  `pdfshush_split_in_half`, `pdfshush_n_up`, `pdfshush_edit`), generated from
  the same zod contracts the API validates with.
- `pdfshush://tools` — the live catalog + the key's quota tier.
- `pdfshush://guide/<slug>` — each slug's `options` vocabulary and file rules.

Attribution: server design adapted from GenOffice
(`packages/cli/src/mcp/`, Apache-2.0); see `licenses/`.
