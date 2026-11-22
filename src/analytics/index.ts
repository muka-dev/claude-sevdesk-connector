/** sevDesk statuses: 100 draft, 200 open, 750 partially paid, 1000 paid. Others count as unknown. */
export type Kind = "invoice" | "credit";

export interface Doc {
  id: string;
  kind: Kind;
  type?: string; // invoiceType: RE, ER, TR, AR, WKR, SR, MA
  status: number;
  number: string | null;
  date: string; // yyyy-MM-dd
  timeToPay: number | null; // days
  gross: number;
  paid: number | null; // null for credit notes (no paidAmount) or missing
  contactId: string | null;
}

export const DEFAULT_MIN_GROUP = 5;
export const DEFAULT_PAY_DAYS = 14;
const REVENUE_TYPES = new Set(["RE", "ER"]);
const REVENUE_STATUS = new Set([200, 750, 1000]);
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whitelist mapper: only these fields ever leave the connector. Sums arrive as strings. */
export function mapDoc(o: any, kind: Kind): Doc {
  // Reject instead of guessing: a missing or non-numeric amount must never count as 0.
  const gross = typeof o.sumGross === "string" || typeof o.sumGross === "number" ? Number(o.sumGross) : NaN;
  if (!Number.isFinite(gross) || (typeof o.sumGross === "string" && o.sumGross.trim() === "")) {
    throw new Error(`Invalid amount on ${kind} ${String(o.id)}`);
  }
  const rawDate = kind === "invoice" ? o.invoiceDate : o.creditNoteDate;
  if (typeof rawDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
    throw new Error(`Invalid date on ${kind} ${String(o.id)}`);
  }
  return {
    id: String(o.id),
    kind,
    type: kind === "invoice" ? o.invoiceType : undefined,
    status: Number(o.status),
    number: (kind === "invoice" ? o.invoiceNumber : o.creditNoteNumber) ?? null,
    date: rawDate.slice(0, 10),
    timeToPay: o.timeToPay == null ? null : Number(o.timeToPay),
    gross,
    paid: o.paidAmount == null ? null : Number(o.paidAmount),
    contactId: o.contact?.id != null ? String(o.contact.id) : null,
  };
}

const counts = (d: Doc) =>
  REVENUE_STATUS.has(d.status) && (d.kind === "credit" || REVENUE_TYPES.has(d.type ?? ""));

const NOTE_STORNO = "Stornorechnungen (SR) sind in dieser Version nicht berücksichtigt.";

export interface MonthRevenue { month: string; gross: number | null; count: number | null; suppressed?: boolean }

export function revenueByMonth(docs: Doc[], minGroup = DEFAULT_MIN_GROUP) {
  const acc = new Map<string, { gross: number; count: number; customers: Set<string> }>();
  let unknown = 0;
  for (const d of docs) {
    if (d.type === "SR") continue;
    if (!counts(d)) {
      if (![100].includes(d.status) && !REVENUE_STATUS.has(d.status)) unknown++;
      continue;
    }
    const m = d.date.slice(0, 7);
    const cur = acc.get(m) ?? { gross: 0, count: 0, customers: new Set<string>() };
    cur.gross = round2(cur.gross + (d.kind === "credit" ? -d.gross : d.gross));
    cur.count++;
    cur.customers.add(d.contactId ?? `doc:${d.id}`);
    acc.set(m, cur);
  }
  const months: MonthRevenue[] = [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) =>
      c.customers.size < minGroup ? { month, gross: null, count: null, suppressed: true } : { month, gross: c.gross, count: c.count },
    );
  return { months, unknownStatusCount: unknown, note: NOTE_STORNO };
}

export type Bucket = "notDue" | "1-30" | "31-60" | "61-90" | "over90";
const BUCKETS: Bucket[] = ["notDue", "1-30", "31-60", "61-90", "over90"];

export function openItems(docs: Doc[], today: Date, minGroup = DEFAULT_MIN_GROUP) {
  const acc = Object.fromEntries(BUCKETS.map((b) => [b, { total: 0, count: 0, customers: new Set<string>() }])) as Record<Bucket, { total: number; count: number; customers: Set<string> }>;
  let withoutPaid = 0;
  let assumedTerms = 0;
  for (const d of docs) {
    if (d.kind !== "invoice" || !REVENUE_TYPES.has(d.type ?? "") || (d.status !== 200 && d.status !== 750)) continue;
    if (d.paid == null) withoutPaid++;
    if (d.timeToPay == null) assumedTerms++;
    const open = round2(d.gross - (d.paid ?? 0));
    if (open <= 0) continue;
    const due = new Date(d.date).getTime() + (d.timeToPay ?? DEFAULT_PAY_DAYS) * DAY_MS;
    const days = Math.floor((today.getTime() - due) / DAY_MS);
    const b: Bucket = days <= 0 ? "notDue" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "over90";
    const a = acc[b];
    a.total = round2(a.total + open);
    a.count++;
    a.customers.add(d.contactId ?? `doc:${d.id}`);
  }
  const buckets = Object.fromEntries(
    BUCKETS.map((b) => [b, acc[b].count > 0 && acc[b].customers.size < minGroup ? { total: null, count: null, suppressed: true } : { total: acc[b].total, count: acc[b].count }]),
  );
  const notes = [NOTE_STORNO];
  if (withoutPaid) notes.push(`${withoutPaid} Rechnung(en) ohne paidAmount: voller Betrag als offen gerechnet.`);
  if (assumedTerms) notes.push(`${assumedTerms} Rechnung(en) ohne Zahlungsziel: ${DEFAULT_PAY_DAYS} Tage angenommen.`);
  return { buckets, notes };
}

export function parseMinGroup(v: string | undefined): number {
  const s = (v ?? "").trim();
  return /^\d+$/.test(s) && Number(s) >= 1 ? Number(s) : DEFAULT_MIN_GROUP;
}

export function customerConcentration(docs: Doc[], minGroup = DEFAULT_MIN_GROUP) {
  const per = new Map<string, number>();
  let total = 0;
  for (const d of docs) {
    if (d.type === "SR" || !counts(d)) continue;
    const sign = d.kind === "credit" ? -1 : 1;
    const key = d.contactId ?? `doc:${d.id}`;
    per.set(key, (per.get(key) ?? 0) + sign * d.gross);
    total += sign * d.gross;
  }
  if (per.size < minGroup) return { suppressed: true, customerCount: null, topShares: [] as { rank: number; shareBand: string }[], note: NOTE_STORNO };
  const band = (s: number) => {
    const lo = Math.min(Math.floor(s / 10) * 10, 90);
    return `${lo}–${lo + 10} %`;
  };
  const topShares = [...per.values()].sort((a, b) => b - a).slice(0, 3)
    .map((g, i) => ({ rank: i + 1, shareBand: band(total > 0 ? (g / total) * 100 : 0) }));
  return { customerCount: per.size, topShares, note: NOTE_STORNO };
}

/** Invoice with its positions, for the VAT summary (Update 2.0: taxRate sits on each position). */
export interface InvoiceDetail {
  id: string;
  number: string | null;
  status: number;
  positions: { taxRate: number; net: number; tax: number }[];
}

export function mapPositions(poss: any[]): InvoiceDetail["positions"] {
  return poss.map((p) => ({ taxRate: Number(p.taxRate), net: Number(p.sumNet), tax: Number(p.sumTax) }));
}

export function vatSummary(invoices: InvoiceDetail[], minGroup = DEFAULT_MIN_GROUP) {
  const acc = new Map<number, { net: number; tax: number; count: number }>();
  for (const inv of invoices) {
    for (const p of inv.positions) {
      const cur = acc.get(p.taxRate) ?? { net: 0, tax: 0, count: 0 };
      cur.net = round2(cur.net + p.net);
      cur.tax = round2(cur.tax + p.tax);
      cur.count++;
      acc.set(p.taxRate, cur);
    }
  }
  return [...acc.entries()].sort(([a], [b]) => a - b).map(([taxRate, v]) =>
    v.count < minGroup ? { taxRate, net: null, tax: null, suppressed: true } : { taxRate, net: v.net, tax: v.tax });
}

/** Invoices without any position: reported separately, not dropped. */
export function missingPositions(invoices: InvoiceDetail[], minGroup = DEFAULT_MIN_GROUP) {
  const m = invoices.filter((i) => i.positions.length === 0);
  if (m.length === 0) return { count: 0, numbers: [] as string[] };
  if (m.length < minGroup) return { count: m.length, numbers: null, suppressed: true };
  return { count: m.length, numbers: m.map((i) => i.number ?? i.id) };
}
