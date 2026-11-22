import { describe, expect, it } from "vitest";
import { mapDoc, openItems, revenueByMonth, customerConcentration, vatSummary, type Doc } from "../src/analytics/index.js";

let n = 0;
const doc = (p: Partial<Doc>): Doc => ({
  id: String(++n), kind: "invoice", type: "RE", status: 200, number: null,
  date: "2026-05-10", timeToPay: 14, gross: 100, paid: 0, contactId: String(n), ...p,
});

describe("mapDoc", () => {
  it("parses string sums and keeps only whitelisted fields", () => {
    const d = mapDoc({ id: "7", invoiceType: "RE", status: "750", invoiceNumber: "RE-1", invoiceDate: "2026-06-01T00:00:00+02:00", sumGross: "95", paidAmount: 23.75, contact: { id: "9" }, addressName: "Secret" }, "invoice");
    expect(d).toEqual({ id: "7", kind: "invoice", type: "RE", status: 750, number: "RE-1", date: "2026-06-01", timeToPay: null, gross: 95, paid: 23.75, contactId: "9" });
  });
});

describe("revenueByMonth", () => {
  it("counts RE/ER in 200/750/1000, subtracts credit notes, skips drafts, SR and other types", () => {
    const docs = [
      doc({ gross: 100 }), doc({ gross: 200, status: 1000, type: "ER" }), doc({ gross: 50, kind: "credit", type: undefined, status: 750, paid: null }),
      doc({ status: 100, gross: 999 }), doc({ type: "SR", gross: 999 }), doc({ type: "TR", gross: 999 }), doc({ type: "MA", gross: 999 }),
    ];
    const r = revenueByMonth(docs, 1);
    expect(r.months).toEqual([{ month: "2026-05", gross: 250, count: 3 }]);
    expect(r.note).toMatch(/Storno/);
  });
  it("suppresses groups below the minimum", () => {
    expect(revenueByMonth([doc({}), doc({})], 5).months[0]).toMatchObject({ gross: null, suppressed: true });
  });
  it("counts unknown statuses", () => {
    expect(revenueByMonth([doc({ status: 300 })], 1).unknownStatusCount).toBe(1);
  });
});

describe("openItems", () => {
  const today = new Date("2026-06-30");
  it("buckets by days past due, uses gross minus paid, ignores paid and drafts", () => {
    const r = openItems([
      doc({ date: "2026-06-25", gross: 100 }), // due 07-09: not due
      doc({ date: "2026-05-10", gross: 200, paid: 50, status: 750 }), // due 05-24: 37 days
      doc({ date: "2026-01-01", gross: 10 }), // over 90
      doc({ status: 1000 }), doc({ status: 100 }), doc({ gross: 100, paid: 100, status: 750 }),
    ], today, 1);
    const b = r.buckets as any;
    expect(b.notDue.total).toBe(100);
    expect(b["31-60"].total).toBe(150);
    expect(b.over90.total).toBe(10);
  });
  it("notes missing terms and paidAmount", () => {
    const r = openItems([doc({ timeToPay: null, paid: null })], today, 1);
    expect(r.notes.join(" ")).toMatch(/Zahlungsziel/);
    expect(r.notes.join(" ")).toMatch(/paidAmount/);
  });
});

describe("customerConcentration", () => {
  it("returns bands only and suppresses small groups", () => {
    expect(customerConcentration([doc({}), doc({})], 5)).toMatchObject({ suppressed: true });
    const docs = [doc({ gross: 600, contactId: "a" }), ...["b", "c", "d", "e"].map((c) => doc({ gross: 100, contactId: c }))];
    const r = customerConcentration(docs, 5) as any;
    expect(r.topShares[0]).toEqual({ rank: 1, shareBand: "60–70 %" });
  });
});

describe("vatSummary", () => {
  it("sums per tax rate", () => {
    const inv = (rate: number, net: number, tax: number) => ({ id: "1", number: null, status: 200, positions: [{ taxRate: rate, net, tax }] });
    expect(vatSummary([inv(19, 100, 19), inv(19, 50, 9.5), inv(7, 10, 0.7)], 1)).toEqual([
      { taxRate: 7, net: 10, tax: 0.7 }, { taxRate: 19, net: 150, tax: 28.5 },
    ]);
  });
});
