/**
 * Reduces personal data in tool results before they reach the model.
 *
 * Level 1 (structured fields): names are replaced by stable pseudonyms
 * ("Kontakt 1", "Kontakt 2", ...) that stay the same for the lifetime of one
 * Redactor. Street, supplement and zip are removed, tax identifiers are removed.
 * City and country are kept for regional evaluations.
 *
 * Level 2 (free text): e-mail addresses, IBANs, USt-IdNr and phone numbers are
 * replaced by placeholders in any string.
 *
 * Not covered: names inside free text (notes, descriptions). That needs named
 * entity recognition and is a separate step.
 */

const PARTY_KEYS = new Set([
  "person", "company", "contactPersons", "street", "zip", "firstName", "lastName",
  "contactName", "emailAddresses", "phoneNumbers", "surename", "familyname", "name2", "addressName", "addressStreet", "addressZip",
]);
/** Child objects that always describe a party, even if the parent does not. */
const PARTY_CHILD_KEYS = new Set(["person", "company", "contactPersons", "address", "addresses", "billing", "shipping"]);
const NAME_KEYS = new Set(["firstName", "lastName", "name", "companyName", "contactName", "surename", "familyname", "name2", "addressName"]);
const ADDRESS_REMOVE_KEYS = new Set(["street", "supplement", "zip", "houseNumber", "addressStreet", "addressZip"]);
const IDENTIFIER_REMOVE_KEYS = new Set(["taxNumber", "vatRegistrationId", "vatNumber", "bankAccount", "bankNumber"]);

const PATTERNS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[E-Mail]"],
  [/\bDE\d{2}(?: ?\d{4}){4} ?\d{2}\b/g, "[IBAN]"],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[IBAN]"],
  [/\bDE ?\d{9}\b/g, "[USt-IdNr]"],
  [/(?:\+|00)\d{1,3}[\s\d/().-]{6,}\d/g, "[Telefon]"],
  [/\b0\d{2,5}[\s/.-]?\d[\d\s/.-]{4,}\d\b/g, "[Telefon]"],
];

export class Redactor {
  private readonly pseudonyms = new Map<string, string>();

  /** Stable pseudonym for one name within this Redactor's lifetime. */
  pseudonym(name: string): string {
    const key = name.trim();
    let p = this.pseudonyms.get(key);
    if (!p) {
      p = `Kontakt ${this.pseudonyms.size + 1}`;
      this.pseudonyms.set(key, p);
    }
    return p;
  }

  redact(value: unknown): unknown {
    return this.walk(value, false);
  }

  private walk(value: unknown, inParty: boolean): unknown {
    if (Array.isArray(value)) return value.map((v) => this.walk(v, inParty));
    if (typeof value === "string") return this.scrubText(value);
    if (value === null || typeof value !== "object") return value;

    const obj = value as Record<string, unknown>;
    const party = inParty || Object.keys(obj).some((k) => PARTY_KEYS.has(k));
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      if (IDENTIFIER_REMOVE_KEYS.has(k) && v !== null && v !== undefined) {
        out[k] = "[entfernt]";
      } else if (party && ADDRESS_REMOVE_KEYS.has(k) && typeof v === "string") {
        out[k] = "[entfernt]";
      } else if (party && NAME_KEYS.has(k) && typeof v === "string") {
        out[k] = this.pseudonym(v);
      } else {
        out[k] = this.walk(v, party || PARTY_CHILD_KEYS.has(k));
      }
    }
    return out;
  }

  private scrubText(text: string): string {
    let out = text;
    for (const [re, placeholder] of PATTERNS) out = out.replace(re, placeholder);
    return out;
  }
}

/**
 * Redaction is on unless SEVDESK_REDACT is explicitly set to an off value.
 * Only switch it off when names in plain text are really needed.
 */
export function redactionEnabled(envValue: string | undefined): boolean {
  const v = (envValue ?? "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(v);
}
