import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

const EXPECTED = [
  "sevdesk_customer_concentration", "sevdesk_get_invoice", "sevdesk_list_invoices", "sevdesk_open_items",
  "sevdesk_revenue_by_month", "sevdesk_search_contacts", "sevdesk_vat_summary",
];

async function connect(client: any) {
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createServer({ client, today: () => new Date("2026-06-30"), minGroupSize: 1 }).connect(s);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(c);
  return mcp;
}
const noop = { get: vi.fn(), getAll: vi.fn(async () => []) };

describe("MCP server", () => {
  it("lists exactly the v0.1 tools, all read-only, all with object schemas (T-11)", async () => {
    const { tools } = await (await connect(noop)).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED);
    expect(tools.every((t) => t.inputSchema?.type === "object")).toBe(true);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("date parameters only accept yyyy-MM-dd", async () => {
    const res: any = await (await connect(noop)).callTool({ name: "sevdesk_revenue_by_month", arguments: { from: "01.01.2026" } })
      .catch((e: unknown) => ({ isError: true, message: String(e) }));
    expect(res.isError).toBe(true);
  });

  it("returns JSON text content and marks tool failures as isError without crashing", async () => {
    const ok: any = await (await connect(noop)).callTool({ name: "sevdesk_list_invoices", arguments: {} });
    expect(JSON.parse(ok.content[0].text)).toEqual([]);
    const failing = { get: vi.fn(), getAll: vi.fn(async () => { throw new Error("sevDesk API error 429 on /Invoice"); }) };
    const mcp = await connect(failing);
    const bad: any = await mcp.callTool({ name: "sevdesk_open_items", arguments: {} });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("429");
    expect((await mcp.listTools()).tools).toHaveLength(7); // still alive
  });

  it("rejects a non-numeric invoice id", async () => {
    const res: any = await (await connect(noop)).callTool({ name: "sevdesk_get_invoice", arguments: { id: "abc" } })
      .catch((e: unknown) => ({ isError: true, message: String(e) }));
    expect(res.isError).toBe(true);
  });
});
