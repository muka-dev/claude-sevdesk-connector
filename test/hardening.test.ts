import { describe, expect, it, vi } from "vitest";
import {
  customerConcentration, mapDoc, mapPositions, missingPositions, openItems, parseMinGroup, revenueByMonth, vatSummary,
  type Doc, type InvoiceDetail,
} from "../src/analytics/index.js";
import { SevdeskClient } from "../src/sevdesk/client.js";
import { buildTools } from "../src/tools.js";

let n = 0;
const doc = (p: Partial<Doc> = {}): Doc => ({
  id: String(++n), kind: "invoice", type: "RE", status: 200, number: null, date: "2026-05-10", timeToPay: 14, gross: 100, paid: 0, contactId: `c${n}`, ...p,
});
const raw = (o: Record<string, unknown> = {}) => ({ id: 1, invoiceType: "RE", status: "200", invoiceNumber: "RE-1", invoiceDate: "2026-05-10T00:00:00+02:00", sumGross: "10", ...o });

describe("mapDoc: strict amounts and dates", () => {
  it.each([[undefined], [null], [""], ["abc"], [{}], [NaN]])("rejects amount %j instead of counting 0", (v) => {
    expect(() => mapDoc(raw({ sumGross: v }), "invoice")).toThrow(/Invalid amount/);
  });
  it("accepts string and number amounts", () => {
    expect(mapDoc(raw({ sumGross: "12.5" }), "invoice").gross).toBe(12.5);
    expect(mapDoc(raw({ sumGross: 7 }), "invoice").gross).toBe(7);
  });
  it.each([[undefined], [null], ["14.02.2026"], [1700000000], [""]])("rejects date %j", (v) => {
    expect(() => mapDoc(raw({ invoiceDate: v }), "invoice")).toThrow(/Invalid date/);
  });
  it("maps credit notes with their own fields and no type", () => {
    const d = mapDoc({ id: 3, status: "750", creditNoteNumber: "GU-1", creditNoteDate: "2026-06-01T00:00:00+02:00", sumGross: "5", paidAmount: null, contact: { id: 9 } }, "credit");
    expect(d).toMatchObject({ kind: "credit", type: undefined, number: "GU-1", paid: null, contactId: "9", timeToPay: null });
  });
  it("handles a missing contact and number", () => {
    expect(mapDoc(raw({ contact: null, invoiceNumber: undefined, timeToPay: "30" }), "invoice")).toMatchObject({ contactId: null, number: null, timeToPay: 30 });
  });
  it("whitelist: only the known keys ever come out, whatever the input carries (property)", () => {
    const allowed = ["contactId", "date", "gross", "id", "kind", "number", "paid", "status", "timeToPay", "type"];
    for (let i = 0; i < 50; i++) {
      const extra = Object.fromEntries(Array.from({ length: 5 }, (_, k) => [`field${i}_${k}`, `Secret ${i}`]));
      const out = mapDoc(raw({ ...extra, addressName: "Klarname", customerInternalNote: "x", bankAccount: "DE00" }), "invoice");
      expect(Object.keys(out).sort()).toEqual(allowed);
      expect(JSON.stringify(out)).not.toMatch(/Secret|Klarname/);
    }
  });
});

describe("status and type tables", () => {
  it.each([
    [{ type: "RE", status: 200 }, true], [{ type: "ER", status: 750 }, true], [{ type: "RE", status: 1000 }, true],
    [{ type: "RE", status: 100 }, false], [{ type: "TR", status: 200 }, false], [{ type: "AR", status: 200 }, false],
    [{ type: "WKR", status: 200 }, false], [{ type: "MA", status: 200 }, false], [{ type: "SR", status: 200 }, false],
  ])("revenue counting %j -> %s", (p, counted) => {
    const r = revenueByMonth([doc(p as any)], 1);
    expect(r.months.length).toBe(counted ? 1 : 0);
  });
  it.each([[50], [300], [500], [999]])("status %i counts as unknown and enters no sum", (status) => {
    const r = revenueByMonth([doc({ status }), doc({ status: 200 })], 1);
    expect(r.unknownStatusCount).toBe(1);
    expect(r.months[0].gross).toBe(100);
  });
  it("credit notes 200/750/1000 reduce revenue, draft does not, count rises per document (T-07)", () => {
    const r = revenueByMonth([doc({ gross: 500 }), ...[200, 750, 1000].map((s) => doc({ kind: "credit", type: undefined, status: s, gross: 100, paid: null })), doc({ kind: "credit", type: undefined, status: 100, gross: 77 })], 1);
    expect(r.months[0]).toMatchObject({ gross: 200 });
  });
  it("month sums add up to the total over random sets (property, fixed seed)", () => {
    let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const docs = Array.from({ length: 200 }, () => {
      const credit = rnd() < 0.2;
      return doc({
        gross: Math.round(rnd() * 100000) / 100, date: `2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-15`,
        contactId: `c${Math.floor(rnd() * 20)}`, kind: credit ? "credit" : "invoice", type: credit ? undefined : "RE", paid: credit ? null : 0,
      });
    });
    const total = docs.reduce((a, d) => a + (d.kind === "credit" ? -d.gross : d.gross), 0);
    const sum = revenueByMonth(docs, 1).months.reduce((a, m) => a + (m.gross ?? 0), 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.05);
  });
});

describe("threshold and note invariants", () => {
  it("suppressed sums appear nowhere else in the answer (T-06)", () => {
    const docs = [doc({ gross: 1234.56, contactId: "a" }), doc({ gross: 1, contactId: "b" })];
    const r = revenueByMonth(docs, 5);
    expect(r.months[0]).toEqual({ month: "2026-05", gross: null, count: null, suppressed: true });
    expect(JSON.stringify(r)).not.toMatch(/1234|1235/);
  });
  it("every evaluation carries the storno note", () => {
    expect(revenueByMonth([], 1).note).toMatch(/Stornorechnungen/);
    expect(openItems([], new Date(), 1).notes[0]).toMatch(/Stornorechnungen/);
    expect(customerConcentration([], 1).note).toMatch(/Stornorechnungen/);
  });
  it("concentration: bands cap at 90–100, zero or negative total gives 0–10, SR and drafts ignored", () => {
    const one = customerConcentration([doc({ gross: 100, contactId: "a" }), doc({ type: "SR", gross: 9999, contactId: "z" }), doc({ status: 100, gross: 9999 })], 1) as any;
    expect(one.customerCount).toBe(1);
    expect(one.topShares[0].shareBand).toBe("90–100 %");
    const neg = customerConcentration([doc({ kind: "credit", type: undefined, gross: 50, contactId: "a" })], 1) as any;
    expect(neg.topShares[0].shareBand).toBe("0–10 %");
  });
  it("concentration without contact falls back to the document", () => {
    expect((customerConcentration([doc({ contactId: null }), doc({ contactId: null })], 2) as any).customerCount).toBe(2);
  });
  it("revenue and open items treat missing contacts as separate customers", () => {
    expect(revenueByMonth([doc({ contactId: null }), doc({ contactId: null })], 2).months[0].gross).toBe(200);
    expect((openItems([doc({ contactId: null }), doc({ contactId: null })], new Date("2026-05-12"), 2).buckets as any).notDue.total).toBe(200);
  });
  it.each([[undefined, 5], ["", 5], ["abc", 5], ["0", 5], ["-1", 5], ["1", 1], [" 12 ", 12]])("parseMinGroup(%j) = %i", (v, e) => {
    expect(parseMinGroup(v as any)).toBe(e);
  });
});

describe("openItems buckets", () => {
  const today = new Date("2026-12-31");
  it.each([
    ["2026-12-20", "notDue"], ["2026-11-25", "1-30"], ["2026-10-25", "31-60"], ["2026-09-25", "61-90"], ["2026-05-01", "over90"],
  ])("invoice dated %s lands in %s", (date, bucket) => {
    const r: any = openItems([doc({ date, timeToPay: 14 })], today, 1);
    expect(r.buckets[bucket].count).toBe(1);
  });
  it("ignores credit notes, other types, settled and draft", () => {
    const r: any = openItems([doc({ kind: "credit", type: undefined }), doc({ type: "TR" }), doc({ status: 1000 }), doc({ status: 100 }), doc({ gross: 50, paid: 50, status: 750 })], today, 1);
    expect(Object.values(r.buckets).every((b: any) => b.count === 0)).toBe(true);
  });
});

describe("VAT helpers", () => {
  const inv = (positions: InvoiceDetail["positions"], number: string | null = null): InvoiceDetail => ({ id: "1", number, status: 200, positions });
  it("rounds to two decimals and sums per rate (T: Rundung)", () => {
    const r = vatSummary([inv([{ taxRate: 19, net: 0.1, tax: 0.019 }]), inv([{ taxRate: 19, net: 0.2, tax: 0.038 }])], 1);
    expect(r).toEqual([{ taxRate: 19, net: 0.3, tax: 0.06 }]);
  });
  it("suppresses rates below the minimum", () => {
    expect(vatSummary([inv([{ taxRate: 7, net: 1, tax: 0.07 }])], 5)).toEqual([{ taxRate: 7, net: null, tax: null, suppressed: true }]);
  });
  it("reports invoices without positions: none, few (suppressed), many (listed)", () => {
    expect(missingPositions([inv([{ taxRate: 0, net: 1, tax: 0 }])], 5)).toEqual({ count: 0, numbers: [] });
    expect(missingPositions([inv([])], 5)).toEqual({ count: 1, numbers: null, suppressed: true });
    expect(missingPositions([inv([], "RE-1"), inv([])], 2)).toEqual({ count: 2, numbers: ["RE-1", "1"] });
  });
  it("mapPositions reads the line sums", () => {
    expect(mapPositions([{ taxRate: "7", sumNet: "10", sumTax: "0.7", priceNet: "5" }])).toEqual([{ taxRate: 7, net: 10, tax: 0.7 }]);
  });
});

describe("client", () => {
  it("uses the default sleep and fetch wiring (fake timers)", async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 429 })).mockResolvedValueOnce(new Response('{"objects":[]}', { status: 200 }));
    const p = new SevdeskClient({ token: "t", fetch: f as any }).get("/Invoice");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ objects: [] });
    vi.useRealTimers();
  });
  it("ignores undefined query values", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await new SevdeskClient({ token: "t", fetch: f as any }).get("/X", { a: undefined, b: null, c: 0 });
    expect(String((f.mock.calls[0] as any)[0])).toBe("https://my.sevdesk.de/api/v1/X?c=0");
  });
});

describe("tools: remaining paths", () => {
  const client = {
    get: vi.fn(async (path: string) => (path === "/Invoice/7" ? { objects: [raw({ id: 7 })] } : path === "/Invoice/8" ? { objects: [] } : { objects: [{ taxRate: "19", sumNet: "8.4", sumTax: "1.6" }] })),
    getAll: vi.fn(async (_p: string, q: any) => [{ id: 5, customerNumber: q?.customerNumber ?? "K-1", name: "Muster GmbH", surename: null, familyname: null, category: { id: 3 } }, { id: 6, customerNumber: "K-2", name: null, surename: "Anna", familyname: "Demo" }]),
  };
  const t = Object.fromEntries(buildTools({ client: client as any, minGroupSize: 1 }).map((x) => [x.name, x]));
  it("get_invoice returns the document with positions, and a clear error for an unknown id", async () => {
    expect(await t.sevdesk_get_invoice.handler({ id: "7" })).toMatchObject({ id: "7", positions: [{ taxRate: 19, net: 8.4, tax: 1.6 }] });
    expect(await t.sevdesk_get_invoice.handler({ id: "8" })).toEqual({ isError: true, message: "Invoice 8 not found" });
  });
  it("search_contacts filters locally and passes depth=20 and the number filter", async () => {
    const r: any = await t.sevdesk_search_contacts.handler({ query: "demo", customerNumber: "K-2" });
    expect(client.getAll).toHaveBeenCalledWith("/Contact", { depth: 20, customerNumber: "K-2" });
    expect(r.map((c: any) => c.id)).toEqual(["6"]);
    expect(((await t.sevdesk_search_contacts.handler({})) as any[]).length).toBe(2);
  });
  it("list_invoices filters by status", async () => {
    const c2 = { get: vi.fn(), getAll: vi.fn(async (p: string) => (p === "/Invoice" ? [raw({ id: 1, status: "200" }), raw({ id: 2, status: "1000" })] : [])) };
    const tt = Object.fromEntries(buildTools({ client: c2 as any, today: () => new Date("2026-12-31") }).map((x) => [x.name, x]));
    expect(((await tt.sevdesk_list_invoices.handler({ status: 1000 })) as any[]).map((d) => d.id)).toEqual(["2"]);
  });
  it("sends the date window to the API in Unix seconds with a day of margin", async () => {
    const c3 = { get: vi.fn(), getAll: vi.fn(async () => []) };
    const tt = Object.fromEntries(buildTools({ client: c3 as any }).map((x) => [x.name, x]));
    await tt.sevdesk_open_items.handler({ from: "2026-06-01", to: "2026-06-30" });
    const q: any = (c3.getAll.mock.calls[0] as any[])[1];
    expect(q.startDate).toBe(Date.parse("2026-06-01") / 1000 - 86400);
    expect(q.endDate).toBe(Date.parse("2026-06-30") / 1000 + 2 * 86400);
  });
});
