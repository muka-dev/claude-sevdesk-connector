import { describe, expect, it, vi } from "vitest";
import { SevdeskClient, SevdeskApiError } from "../src/sevdesk/client.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("SevdeskClient", () => {
  it("sends the bare token without Bearer prefix", async () => {
    const f = vi.fn(async () => json({ objects: [] }));
    await new SevdeskClient({ token: "tok", fetch: f as any }).get("/Invoice", { limit: 5 });
    const [url, init] = f.mock.calls[0] as any;
    expect(init.headers.Authorization).toBe("tok");
    expect(url).toBe("https://my.sevdesk.de/api/v1/Invoice?limit=5");
  });

  it("pages with explicit limit until a short page", async () => {
    const page = (n: number) => json({ objects: Array.from({ length: n }, (_, i) => ({ id: i })) });
    const f = vi.fn().mockResolvedValueOnce(page(1000)).mockResolvedValueOnce(page(3));
    const all = await new SevdeskClient({ token: "t", fetch: f as any }).getAll("/Invoice");
    expect(all).toHaveLength(1003);
    expect(String((f.mock.calls[1] as any)[0])).toContain("offset=1000");
    expect(String((f.mock.calls[1] as any)[0])).toContain("limit=1000");
  });

  it("retries on 429 with Retry-After", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "2" })).mockResolvedValueOnce(json({ objects: [] }));
    const sleep = vi.fn(async () => {});
    await new SevdeskClient({ token: "t", fetch: f as any, sleep }).get("/Invoice");
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("errors without leaking the response body", async () => {
    const f = vi.fn(async () => json({ secret: "account-data" }, 500));
    const err = (await new SevdeskClient({ token: "t", fetch: f as any, maxRetries: 0 }).get("/Invoice").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(SevdeskApiError);
    expect(err.message).toBe("sevDesk API error 500 on /Invoice");
  });

  it("requires a token", () => {
    expect(() => new SevdeskClient({ token: "" })).toThrow(/SEVDESK_TOKEN/);
  });
});
