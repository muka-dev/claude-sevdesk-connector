import { createServer as http, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { SevdeskClient } from "../src/sevdesk/client.js";
import { buildTools } from "../src/tools.js";

// Replay server with synthetic documents shaped like the live responses (strings for sums, ISO dates with offset).
const inv = (id: number, over: Record<string, unknown> = {}) => ({
  id: String(id), invoiceType: "RE", status: "200", invoiceNumber: `RE-${id}`, invoiceDate: "2026-05-10T00:00:00+02:00",
  sumGross: "100", paidAmount: 0, timeToPay: null, contact: { id: String(id % 7) }, addressName: "Klarname", ...over,
});

let server: Server;
async function serve(handler: (url: URL, n: number) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  let n = 0;
  server = http((req, res) => {
    const r = handler(new URL(req.url!, "http://x"), ++n);
    res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
    res.end(JSON.stringify(r.body ?? {}));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as any).port;
  return { base: `http://127.0.0.1:${port}`, count: () => n };
}
afterEach(() => new Promise<void>((ok) => (server ? server.close(() => ok()) : ok())));
const mk = (base: string) => new SevdeskClient({ token: "SECRET-TOKEN-123", baseUrl: base, sleep: async () => {} });

describe("replay: paging (T-12)", () => {
  it("collects three pages without duplicates", async () => {
    const all = Array.from({ length: 2503 }, (_, i) => inv(i + 1));
    const s = await serve((u) => {
      const off = Number(u.searchParams.get("offset")), lim = Number(u.searchParams.get("limit"));
      return { status: 200, body: { objects: all.slice(off, off + lim) } };
    });
    const got = await mk(s.base).getAll<any>("/Invoice");
    expect(got).toHaveLength(2503);
    expect(new Set(got.map((o) => o.id)).size).toBe(2503);
    expect(s.count()).toBe(3);
  });
});

describe("replay: errors and retries", () => {
  it("retries after a 429 in the middle of a run and still returns everything", async () => {
    const s = await serve((_u, n) => (n === 2 ? { status: 429, headers: { "retry-after": "1" } } : { status: 200, body: { objects: [inv(n)] } }));
    const c = mk(s.base);
    expect((await c.getAll<any>("/Invoice")).length).toBe(1);
    expect((await c.get<any>("/Invoice")).objects).toHaveLength(1);
    expect((await c.get<any>("/Invoice")).objects).toHaveLength(1); // call 2 was 429, retried as call 3
  });

  it("backs off exponentially without Retry-After", async () => {
    const waits: number[] = [];
    const s = await serve((_u, n) => (n < 3 ? { status: 429 } : { status: 200, body: { objects: [] } }));
    await new SevdeskClient({ token: "t", baseUrl: s.base, sleep: async (ms) => { waits.push(ms); } }).get("/Invoice");
    expect(waits).toEqual([1000, 2000]);
  });

  it("gives up after the retry budget on persistent 429", async () => {
    const s = await serve(() => ({ status: 429 }));
    await expect(mk(s.base).get("/Invoice")).rejects.toThrow(/429/);
    expect(s.count()).toBe(4);
  });

  it("401: message has status and path only, never token or body (T-02)", async () => {
    const s = await serve(() => ({ status: 401, body: { error: "token SECRET-TOKEN-123 invalid", account: "x@y.de" } }));
    const err = (await mk(s.base).get("/Invoice", { limit: 5 }).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("sevDesk API error 401 on /Invoice");
    expect(JSON.stringify(err)).not.toMatch(/SECRET|x@y/);
    expect(String(err.stack)).not.toMatch(/SECRET/);
  });

  it("sends only GET with the bare token", async () => {
    let seen: any;
    const s = await serve(() => ({ status: 200, body: { objects: [] } }));
    server.on("request", (req) => { seen = { m: req.method, a: req.headers.authorization }; });
    await mk(s.base).get("/Invoice");
    expect(seen).toEqual({ m: "GET", a: "SECRET-TOKEN-123" });
  });

  it("network failure surfaces as an error without the token", async () => {
    const err = (await mk("http://127.0.0.1:1").get("/Invoice").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message) + String(err.stack)).not.toMatch(/SECRET/);
  });
});

describe("replay: tools end to end", () => {
  it("revenue over two months with a credit note matches the reference, no clear names leak (T-07)", async () => {
    const s = await serve((u) => {
      const p = u.pathname;
      if (p === "/Invoice") return { status: 200, body: { objects: [
        inv(1, { invoiceDate: "2026-04-05T00:00:00+02:00", sumGross: "300", contact: { id: "1" } }),
        inv(2, { invoiceDate: "2026-05-05T00:00:00+02:00", sumGross: "500", status: "1000", contact: { id: "2" } }),
        inv(3, { status: "100", sumGross: "999" }), inv(4, { invoiceType: "TR", sumGross: "999" }),
        inv(5, { invoiceType: "SR", sumGross: "999" }),
      ] } };
      if (p === "/CreditNote") return { status: 200, body: { objects: [
        { id: "9", status: "750", creditNoteNumber: "GU-1", creditNoteDate: "2026-05-20T00:00:00+02:00", sumGross: "120", paidAmount: null, contact: { id: "2" }, addressName: "Klarname" },
      ] } };
      return { status: 404 };
    });
    const tools = Object.fromEntries(buildTools({ client: mk(s.base), minGroupSize: 1, today: () => new Date("2026-06-30") }).map((t) => [t.name, t]));
    const rev: any = await tools.sevdesk_revenue_by_month.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(rev.months).toEqual([{ month: "2026-04", gross: 300, count: 1 }, { month: "2026-05", gross: 380, count: 2 }]);
    expect(rev.months.reduce((a: number, m: any) => a + m.gross, 0)).toBe(680);
    expect(rev.note).toMatch(/Storno/);
    expect(JSON.stringify(await tools.sevdesk_list_invoices.handler({}))).not.toMatch(/Klarname/);
  });

  it("aging uses gross minus paidAmount for a partial payment (T-04)", async () => {
    const s = await serve((u) => ({ status: 200, body: { objects: u.pathname === "/Invoice" ? [inv(1, { status: "750", sumGross: "200", paidAmount: 50, invoiceDate: "2026-06-25T00:00:00+02:00", timeToPay: 14 })] : [] } }));
    const t = Object.fromEntries(buildTools({ client: mk(s.base), minGroupSize: 1, today: () => new Date("2026-06-30") }).map((x) => [x.name, x]));
    const r: any = await t.sevdesk_open_items.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(r.buckets.notDue).toEqual({ total: 150, count: 1 });
  });

  it("VAT summary stays within the call budget and reports invoices without positions (T-12)", async () => {
    const s = await serve((u) => {
      if (u.pathname === "/Invoice") return { status: 200, body: { objects: [inv(1), inv(2)] } };
      if (u.pathname === "/CreditNote") return { status: 200, body: { objects: [] } };
      if (u.pathname === "/InvoicePos") return { status: 200, body: { objects: u.searchParams.get("invoice[id]") === "1" ? [{ taxRate: "19", sumNet: "84.03", sumTax: "15.97" }] : [] } };
      return { status: 404 };
    });
    const t = Object.fromEntries(buildTools({ client: mk(s.base), minGroupSize: 1 }).map((x) => [x.name, x]));
    const r: any = await t.sevdesk_vat_summary.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(r.rates).toEqual([{ taxRate: 19, net: 84.03, tax: 15.97 }]);
    expect(r.invoicesWithoutPositions).toMatchObject({ count: 1 });
    expect(s.count()).toBe(4); // Invoice, CreditNote, 2x InvoicePos
  });
});
