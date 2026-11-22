import { z } from "zod";
import type { SevdeskClient, QueryValue } from "./sevdesk/client.js";
import {
  DEFAULT_MIN_GROUP,
  customerConcentration,
  mapDoc,
  mapPositions,
  missingPositions,
  openItems,
  revenueByMonth,
  vatSummary,
  type Doc,
  type InvoiceDetail,
} from "./analytics/index.js";

export interface ToolContext {
  client: Pick<SevdeskClient, "get" | "getAll">;
  today?: () => Date;
  /** Upper bound of position calls per VAT summary (rate limit protection). */
  maxInvoiceDetails?: number;
  /** Optional redaction applied to successful results before they leave the connector. */
  redact?: (value: unknown) => unknown;
  /** Minimum group size for evaluations (default 5). 1 disables the threshold. */
  minGroupSize?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: any) => Promise<unknown>;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-MM-dd");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const yearStart = (d: Date) => `${d.getFullYear()}-01-01`;
const DAY = 86_400;

/** Builds the read-only tool set. Pure wiring: all HTTP goes through ctx.client. */
export function buildTools(ctx: ToolContext): ToolDef[] {
  const today = ctx.today ?? (() => new Date());
  const maxDetails = ctx.maxInvoiceDetails ?? 200;
  const minGroup = ctx.minGroupSize ?? DEFAULT_MIN_GROUP;
  const detailCache = new Map<string, InvoiceDetail>();

  const range = (a: { from?: string; to?: string }) => ({ from: a.from ?? yearStart(today()), to: a.to ?? ymd(today()) });
  const inRange = (d: Doc, from: string, to: string) => d.date >= from && d.date <= to;

  /** Date filters take Unix seconds (belegt). One day margin, exact filtering happens locally. */
  const listDocs = async (a: { from?: string; to?: string }): Promise<Doc[]> => {
    const { from, to } = range(a);
    const q: Record<string, QueryValue> = {
      startDate: Math.floor(Date.parse(from) / 1000) - DAY,
      endDate: Math.floor(Date.parse(to) / 1000) + 2 * DAY,
    };
    const [inv, cn] = await Promise.all([
      ctx.client.getAll<any>("/Invoice", q),
      ctx.client.getAll<any>("/CreditNote", q),
    ]);
    return [...inv.map((o) => mapDoc(o, "invoice")), ...cn.map((o) => mapDoc(o, "credit"))].filter((d) => inRange(d, from, to));
  };

  const detail = async (d: Doc): Promise<InvoiceDetail> => {
    const hit = detailCache.get(d.id);
    if (hit) return hit;
    const res = await ctx.client.get<{ objects: any[] }>("/InvoicePos", {
      "invoice[id]": d.id, "invoice[objectName]": "Invoice", limit: 1000,
    });
    const det = { id: d.id, number: d.number, status: d.status, positions: mapPositions(res.objects) };
    detailCache.set(d.id, det);
    return det;
  };

  const tools: ToolDef[] = [
    {
      name: "sevdesk_search_contacts",
      description: "Search customers by name or customer number (filtered locally, GET /Contact needs depth=20). Returns id, customer number, category and name only.",
      inputSchema: { query: z.string().optional(), customerNumber: z.string().optional() },
      handler: async (a) => {
        const all = await ctx.client.getAll<any>("/Contact", { depth: 20, ...(a.customerNumber ? { customerNumber: a.customerNumber } : {}) });
        const q = (a.query ?? "").toLowerCase();
        return all
          .map((c) => ({
            id: String(c.id),
            customerNumber: c.customerNumber ?? null,
            category: c.category?.id ?? null,
            name: c.name ?? null,
            surename: c.surename ?? null,
            familyname: c.familyname ?? null,
          }))
          .filter((c) => !q || [c.name, c.surename, c.familyname, c.customerNumber].some((v) => v?.toLowerCase().includes(q)))
          .slice(0, 25);
      },
    },
    {
      name: "sevdesk_list_invoices",
      description: "List invoices and credit notes in a date range with status (100 draft, 200 open, 750 partially paid, 1000 paid), type, amounts and paid amount. No addresses or free text.",
      inputSchema: { from: isoDate.optional(), to: isoDate.optional(), status: z.number().int().optional() },
      handler: async (a) => (await listDocs(a)).filter((d) => a.status === undefined || d.status === a.status),
    },
    {
      name: "sevdesk_get_invoice",
      description: "Get one invoice with its positions (tax rate, net, tax).",
      inputSchema: { id: z.string().regex(/^\d+$/) },
      handler: async (a) => {
        const inv = await ctx.client.get<{ objects: any[] }>(`/Invoice/${a.id}`);
        if (!inv.objects?.[0]) throw new Error(`Invoice ${a.id} not found`);
        const doc = mapDoc(inv.objects[0], "invoice");
        return { ...doc, positions: (await detail(doc)).positions };
      },
    },
    {
      name: "sevdesk_open_items",
      description: "Open receivables (Offene Posten) grouped by days past due: not due, 1-30, 31-60, 61-90, over 90 days. Invoices only, remaining amount = gross minus paidAmount.",
      inputSchema: { from: isoDate.optional(), to: isoDate.optional() },
      handler: async (a) => openItems(await listDocs(a), today(), minGroup),
    },
    {
      name: "sevdesk_revenue_by_month",
      description: "Gross revenue per calendar month from invoices (RE, ER) minus credit notes, statuses 200/750/1000. Drafts, reminders, partial and down payment invoices are excluded.",
      inputSchema: { from: isoDate.optional(), to: isoDate.optional() },
      handler: async (a) => revenueByMonth(await listDocs(a), minGroup),
    },
    {
      name: "sevdesk_customer_concentration",
      description: "How concentrated revenue is: number of customers and the share held by the three largest, as 10-point bands. Names and amounts are not returned. Suppressed below the minimum group size.",
      inputSchema: { from: isoDate.optional(), to: isoDate.optional() },
      handler: async (a) => customerConcentration(await listDocs(a), minGroup),
    },
    {
      name: "sevdesk_vat_summary",
      description: "Net and VAT totals per tax rate for a period, from invoice positions. Invoices without positions are reported separately. One call per invoice, cached per session, capped.",
      inputSchema: { from: isoDate.optional(), to: isoDate.optional() },
      handler: async (a) => {
        const docs = (await listDocs(a)).filter((d) => d.kind === "invoice" && ["RE", "ER"].includes(d.type ?? "") && [200, 750, 1000].includes(d.status));
        if (docs.length > maxDetails) throw new Error(`Too many invoices for one VAT summary (${docs.length} > ${maxDetails}). Narrow the date range.`);
        const details: InvoiceDetail[] = [];
        for (const d of docs) details.push(await detail(d));
        return { rates: vatSummary(details, minGroup), invoicesWithoutPositions: missingPositions(details, minGroup) };
      },
    },
  ];

  return tools.map((t) => ({
    ...t,
    handler: async (args: any) => {
      try {
        const data = await t.handler(args ?? {});
        return ctx.redact ? ctx.redact(data) : data;
      } catch (err) {
        return { isError: true, message: err instanceof Error ? err.message : String(err) };
      }
    },
  }));
}
