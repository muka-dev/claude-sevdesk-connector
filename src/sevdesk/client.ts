export const SEVDESK_BASE_URL = "https://my.sevdesk.de/api/v1";
const PAGE_SIZE = 1000;

export class SevdeskApiError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) {
    super(message);
    this.name = "SevdeskApiError";
  }
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export type QueryValue = string | number | boolean | undefined | null;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read-only sevDesk client. Auth header carries the bare token (no Bearer prefix, belegt). */
export class SevdeskClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(opts: ClientOptions) {
    if (!opts.token) throw new Error("sevDesk API token is missing. Set SEVDESK_TOKEN.");
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? SEVDESK_BASE_URL;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async get<T = unknown>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { Authorization: this.token, Accept: "application/json" },
      });
      if (res.status === 429 && attempt < this.maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      // Never include the response body: it can hold account data.
      if (!res.ok) throw new SevdeskApiError(`sevDesk API error ${res.status} on ${path}`, res.status, path);
      return (await res.json()) as T;
    }
  }

  /** All objects of a list endpoint. limit is always explicit (belegt: ohne limit gibt es evtl. eine stille Kappung). */
  async getAll<T>(path: string, query: Record<string, QueryValue> = {}, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const res = await this.get<{ objects: T[] }>(path, { ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      out.push(...res.objects);
      if (res.objects.length < PAGE_SIZE) break;
    }
    return out;
  }
}
