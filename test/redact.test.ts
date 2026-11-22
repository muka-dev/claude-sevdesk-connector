import { describe, expect, it } from "vitest";
import { Redactor, redactionEnabled } from "../src/redact/index.js";

describe("Redactor", () => {
  it("gives the same name the same pseudonym and different names different ones", () => {
    const r = new Redactor();
    expect(r.pseudonym("Anna Demo")).toBe("Kontakt 1");
    expect(r.pseudonym("Bernd Test")).toBe("Kontakt 2");
    expect(r.pseudonym(" Anna Demo ")).toBe("Kontakt 1");
  });

  it("replaces contact names, also across calls (T-09)", () => {
    const r = new Redactor();
    const a: any = r.redact({ id: "1", surename: "Anna", familyname: "Demo", name: null });
    const b: any = r.redact({ id: "2", surename: "Anna", familyname: "Demo", name: null });
    expect(a.surename).toBe(b.surename);
    expect(JSON.stringify(a)).not.toMatch(/Anna|Demo/);
  });

  it("pseudonymizes company names and removes address and tax identifiers, keeps city", () => {
    const out: any = new Redactor().redact({
      id: "5", customerNumber: "K-1", name: "Muster GmbH", category: { id: 3 },
      addresses: [{ street: "Weg 1", zip: "12345", city: "Berlin", name: "Muster GmbH" }],
      vatNumber: "DE123456789", taxNumber: "12/345/6789", bankAccount: "DE02120300000000202051",
    });
    expect(out.name).toBe("Kontakt 1");
    expect(out.addresses[0]).toMatchObject({ street: "[entfernt]", zip: "[entfernt]", city: "Berlin", name: "Kontakt 1" });
    expect(out.vatNumber).toBe("[entfernt]");
    expect(out.taxNumber).toBe("[entfernt]");
    expect(out.bankAccount).toBe("[entfernt]");
  });

  it.each([
    ["Mail an max@example.com bitte", "[E-Mail]"],
    ["IBAN DE02 1203 0000 0000 2020 51 bitte", "[IBAN]"],
    ["USt DE123456789", "[USt-IdNr]"],
    ["Tel. +49 30 1234567", "[Telefon]"],
    ["Tel. 030 1234567", "[Telefon]"],
  ])("scrubs free text: %s", (text, placeholder) => {
    expect((new Redactor().redact(text) as string)).toContain(placeholder);
  });

  it("keeps numbers, booleans, null and plain strings, walks arrays", () => {
    const out: any = new Redactor().redact({ a: 1, b: true, c: null, d: ["x", { e: 2 }] });
    expect(out).toEqual({ a: 1, b: true, c: null, d: ["x", { e: 2 }] });
  });

  it("known weakness: names inside free text are not detected (documented)", () => {
    expect(new Redactor().redact("Rücksprache mit Frau Musterfrau")).toBe("Rücksprache mit Frau Musterfrau");
  });
});

describe("redactionEnabled", () => {
  it.each([[undefined, true], ["", true], ["1", true], ["0", false], ["false", false], ["NO", false], [" off ", false]])(
    "%j -> %s", (v, expected) => expect(redactionEnabled(v as any)).toBe(expected));
});
