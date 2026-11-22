# claude-sevdesk-connector

Read-only MCP connector for [sevDesk](https://sevdesk.de): contacts, invoices and evaluations for Claude. Same structure as the [Lexware Office connector](https://github.com/muka-dev/claude-lexware-office-connector).

Status: prototype (v0.1). Not an official sevDesk product. No claims about certification, guarantees or legal compliance.

## Tools

| Tool | Purpose |
|---|---|
| `sevdesk_search_contacts` | Find customers by name or customer number |
| `sevdesk_list_invoices` | Invoices and credit notes in a date range (whitelisted fields only) |
| `sevdesk_get_invoice` | One invoice with positions |
| `sevdesk_open_items` | Open receivables by days past due |
| `sevdesk_revenue_by_month` | Gross revenue per month (RE, ER minus credit notes) |
| `sevdesk_customer_concentration` | Share of the three largest customers, as bands |
| `sevdesk_vat_summary` | Net and VAT per tax rate, from invoice positions |

All tools are read-only. Stornorechnungen (SR) are excluded in v0.1 and every evaluation says so; storno logic follows in v0.3.

## Setup

```bash
npm install && npm run build
SEVDESK_TOKEN=<api token> node dist/main.js   # MCP over stdio
```

| Variable | Default | Meaning |
|---|---|---|
| `SEVDESK_TOKEN` | – | API token (sent as the bare `Authorization` value) |
| `SEVDESK_REDACT` | on | Names become pseudonyms, addresses and tax IDs are removed. `0` turns it off |
| `SEVDESK_MIN_GROUP` | 5 | Groups with fewer distinct customers are suppressed |

## Development

```bash
npm test && npm run typecheck
SEVDESK_TOKEN=<token> node scripts/live-check.mjs   # end-to-end against a test account
```

Findings from the live API are tracked in [docs/DESIGN.md](docs/DESIGN.md) (section 9). `testdata/` holds the generators for the test account.

MIT license.
