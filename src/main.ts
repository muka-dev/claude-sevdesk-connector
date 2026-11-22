#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SevdeskClient } from "./sevdesk/client.js";
import { createServer } from "./server.js";
import { Redactor, redactionEnabled } from "./redact/index.js";
import { parseMinGroup } from "./analytics/index.js";

async function main() {
  const token = process.env.SEVDESK_TOKEN ?? "";
  // stdout is the MCP channel: log to stderr only, and never log the token.
  const client = new SevdeskClient({ token });
  // Redaction is on by default: names become pseudonyms, addresses and tax IDs are removed
  // before results reach the model. Set SEVDESK_REDACT=0 only if plain names are needed.
  const redactOn = redactionEnabled(process.env.SEVDESK_REDACT);
  const redactor = new Redactor();
  const server = createServer({
    client,
    redact: redactOn ? (v) => redactor.redact(v) : undefined,
    // Evaluations hide groups with fewer distinct customers than this (default 5).
    minGroupSize: parseMinGroup(process.env.SEVDESK_MIN_GROUP),
  });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Failed to start sevDesk connector:", err instanceof Error ? err.message : err);
  process.exit(1);
});
