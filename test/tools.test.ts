import { describe, expect, it } from "vitest";
import { buildTools } from "../src/tools.js";
import { Redactor } from "../src/redact/index.js";

const invoice = (id: string, status: string, extra: object = {}) => ({
  id, invoiceType: "RE", status, invoiceNumber: `RE-${id}`, invoiceDate: "2026-05-10T00:00:00+02:00",
  sumGross: "100", paidAmount: 0, contact: { id: `c${id}` }, addressName: "Max Muster", addressStreet: "Weg 1", ...extra,
});

const client = {
  get: async (path: string) => (path.startsWith("/InvoicePos") ? { objects: [{ taxRate: "19", sumNet: "84.03", sumTax: "15.97" }] } : { objects: [invoice("1", "200")] }),
  getAll: async (path: string, q?: any) =>
    path === "/Invoice" ? [invoice("1", "200"), invoice("2", "1000")] : path === "/CreditNote" ? [] :
    [{ id: 5, customerNumber: "K-1", name: "Muster GmbH", surename: null, familyname: null, category: { id: 3 } }],
};
const tools = (extra = {}) => Object.fromEntries(buildTools({ client: client as any, today: () => new Date("2026-06-30"), minGroupSize: 1, ...extra }).map((t) => [t.name, t]));

describe("tools", () => {
  it("exposes the whitelist only, no address fields", async () => {
    const r: any = await tools().sevdesk_list_invoices.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(r).toHaveLength(2);
    expect(JSON.stringify(r)).not.toMatch(/Muster|Weg 1/);
  });
  it("pseudonymizes contact names when redaction is on", async () => {
    const red = new Redactor();
    const r: any = await tools({ redact: (v: unknown) => red.redact(v) }).sevdesk_search_contacts.handler({ query: "muster" });
    expect(r[0].name).toBe("Kontakt 1");
  });
  it("runs revenue and vat summary", async () => {
    const t = tools();
    const rev: any = await t.sevdesk_revenue_by_month.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(rev.months[0]).toMatchObject({ month: "2026-05", gross: 200 });
    const vat: any = await t.sevdesk_vat_summary.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(vat.rates[0]).toMatchObject({ taxRate: 19, net: 168.06 });
  });
  it("turns errors into isError results", async () => {
    const t = tools({ client: { get: async () => { throw new Error("boom"); }, getAll: async () => { throw new Error("boom"); } } });
    expect(await t.sevdesk_open_items.handler({})).toEqual({ isError: true, message: "boom" });
  });
  it("caps VAT detail calls", async () => {
    const r: any = await tools({ maxInvoiceDetails: 1 }).sevdesk_vat_summary.handler({ from: "2026-01-01", to: "2026-12-31" });
    expect(r.isError).toBe(true);
  });
});
