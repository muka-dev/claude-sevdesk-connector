#!/usr/bin/env node
// Read-only live check: runs every tool end to end against the real sevDesk API.
// Needs a built dist/ and SEVDESK_TOKEN. Prints aggregates only.
// Usage: npm run build && node scripts/live-check.mjs [from yyyy-MM-dd] [to yyyy-MM-dd]
import { SevdeskClient } from "../dist/sevdesk/client.js";
import { buildTools } from "../dist/tools.js";
import { Redactor } from "../dist/redact/index.js";
import { parseMinGroup } from "../dist/analytics/index.js";

if (!process.env.SEVDESK_TOKEN) { console.error("SEVDESK_TOKEN is not set. Nothing was sent."); process.exit(1); }
const [from, to] = [process.argv[2] ?? "2026-01-01", process.argv[3] ?? "2026-12-31"];
const redactor = new Redactor();
const tools = Object.fromEntries(buildTools({
  client: new SevdeskClient({ token: process.env.SEVDESK_TOKEN }),
  redact: (v) => redactor.redact(v),
  minGroupSize: parseMinGroup(process.env.SEVDESK_MIN_GROUP),
  today: () => new Date("2026-11-22"),
}).map((t) => [t.name, t]));

const run = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await tools[name].handler(args);
  return [r, Date.now() - t0];
};
const show = (name, r, ms, extra = "") => console.log(`${name} (${ms} ms) ${r?.isError ? "FEHLER: " + r.message : extra}`);

let [r, ms] = await run("sevdesk_list_invoices", { from, to });
const byKey = {};
for (const d of r) byKey[`${d.kind}/${d.type ?? "-"}/${d.status}`] = (byKey[`${d.kind}/${d.type ?? "-"}/${d.status}`] ?? 0) + 1;
show("list_invoices", r, ms, `${r.length} Belege ${JSON.stringify(byKey)}`);

for (const n of ["sevdesk_revenue_by_month", "sevdesk_open_items", "sevdesk_customer_concentration", "sevdesk_vat_summary"]) {
  [r, ms] = await run(n, { from, to });
  show(n, r, ms, JSON.stringify(r));
}
[r, ms] = await run("sevdesk_search_contacts", { query: "a" });
show("search_contacts", r, ms, `${r.length} Treffer, Felder: ${Object.keys(r[0] ?? {}).join(",")}, Beispielname: ${r[0]?.name ?? r[0]?.surename}`);
