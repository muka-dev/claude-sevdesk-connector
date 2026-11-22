#!/usr/bin/env python3
"""Legt Testbelege im sevDesk-Testkonto an (Rechnungen, Gutschriften, alle Statusstufen).

Sicherheit:
  * Standard ist Dry-Run, Schreiben nur mit --apply.
  * Das Token kommt aus SEVDESK_TOKEN und steht nie im Code oder in der Ausgabe.
    (Hinter einem Proxy, der den Header setzt, genügt ein Platzhalter.)
  * Jeder Beleg trägt im Kopf den Marker "TEST-<Schlüssel>". Vorhandene Marker werden
    übersprungen (idempotent). --purge löscht alle Belege mit Marker (nur Entwürfe
    direkt, andere werden zuerst auf Entwurf zurückgesetzt, falls die API es erlaubt).
  * Es werden ausschließlich die Testpersonen TP-0001 bis TP-0010 verwendet.

Nutzung:
  SEVDESK_TOKEN=... python3 generate_invoices.py            # Dry-Run, zeigt den Plan
  SEVDESK_TOKEN=... python3 generate_invoices.py --apply --limit 5
  SEVDESK_TOKEN=... python3 generate_invoices.py --apply
  SEVDESK_TOKEN=... python3 generate_invoices.py --purge
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta

BASE = os.environ.get("SEVDESK_BASE_URL", "https://my.sevdesk.de/api/v1")
MARKER = "TEST-"
SEED = 20260101
COUNTRY_DE = 1  # StaticCountry Deutschland
UNITY_PIECE, UNITY_HOUR = 1, 9
RULE_STANDARD, RULE_SMALL = 1, 11  # TaxRule: USTPFL_UMS_EINN, KLEINUNTERNEHMER_P19


class ApiError(Exception):
    pass


class Api:
    def __init__(self) -> None:
        self.token = os.environ.get("SEVDESK_TOKEN", "")
        self.calls = 0
        self.rate_limited = 0

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            BASE + path,
            method=method,
            data=data,
            headers={"Authorization": self.token, "Content-Type": "application/json"},
        )
        for attempt in range(4):
            self.calls += 1
            try:
                with urllib.request.urlopen(req) as r:
                    raw = r.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    self.rate_limited += 1
                    time.sleep(2 ** attempt)
                    continue
                # Antworttext bewusst nicht ausgeben (kann Kontodaten enthalten)
                raise ApiError(f"{method} {path.split('?')[0]} -> HTTP {e.code}") from None
        raise ApiError(f"{method} {path.split('?')[0]} -> HTTP 429 nach Wiederholungen")


@dataclass
class Spec:
    key: str
    kind: str  # "invoice" | "credit"
    inv_type: str  # RE, ER, TR, AR
    status: int  # Zielstatus: 100, 200, 750, 1000
    contact: str  # TP-000x
    day: date
    rule: int
    positions: list[tuple[str, float, float, float, int]]  # name, qty, price(net), rate, unity
    paid_fraction: float = 0.0  # nur bei 750


def build_plan() -> list[Spec]:
    rnd = random.Random(SEED)
    persons = [f"TP-{i:04d}" for i in range(1, 11)]
    start = date(2026, 3, 1)
    plan: list[Spec] = []

    def positions(rule: int) -> list[tuple[str, float, float, float, int]]:
        if rule == RULE_SMALL:
            return [("Beratung", rnd.choice([1, 2, 4, 8]), rnd.choice([80, 95, 120]), 0, UNITY_HOUR)]
        rates = rnd.choice([[19], [7], [19, 7], [19, 19]])
        return [
            (f"Position {n + 1}", rnd.choice([1, 2, 3, 5]), rnd.choice([49.9, 120.0, 250.0, 999.0]), r, UNITY_PIECE)
            for n, r in enumerate(rates)
        ]

    # Verteilung: 52 Rechnungen RE, 4 Sonderformen, 8 Gutschriften
    mix = [(100, 10), (200, 16), (750, 12), (1000, 14)]
    n = 0
    for status, count in mix:
        for _ in range(count):
            n += 1
            # Belegt: Konto im Geltungsbereich SMALL_BUSINESS, sendBy mit taxRule 1 -> HTTP 422.
            # Regel 1 (19 %/7 %) daher nur in Entwürfen, alles Finalisierte läuft mit Regel 11.
            rule = RULE_STANDARD if (status == 100 and rnd.random() < 0.6) else RULE_SMALL
            plan.append(Spec(
                key=f"RE-{n:03d}", kind="invoice", inv_type="RE", status=status,
                contact=rnd.choice(persons), day=start + timedelta(days=rnd.randint(0, 260)),
                rule=rule, positions=positions(rule),
                paid_fraction=rnd.choice([0.25, 0.5, 0.75]) if status == 750 else 0.0,
            ))
    # Sonderformen (Typen, die nicht in den Umsatz zählen sollen)
    # ER (Schlussrechnung) entfällt: sendBy -> 422 "All origin documents of a final invoice have to be of the same type"
    for typ in ("TR", "AR"):
        n += 1
        plan.append(Spec(f"{typ}-{n:03d}", "invoice", typ, 200, rnd.choice(persons),
                         start + timedelta(days=rnd.randint(0, 260)), RULE_SMALL, positions(RULE_SMALL)))
    # Gutschriften
    for status in (100, 100, 200, 200, 200, 750, 1000, 1000):
        n += 1
        plan.append(Spec(f"GS-{n:03d}", "credit", "", status, rnd.choice(persons),
                         start + timedelta(days=rnd.randint(30, 260)),
                         RULE_SMALL, positions(RULE_SMALL),
                         paid_fraction=0.5 if status == 750 else 0.0))
    plan.sort(key=lambda s: s.day)
    return plan


def ref(i: object, name: str) -> dict:
    return {"id": i, "objectName": name}


def payload(spec: Spec, contact_id: str, user_id: str, credit: bool) -> dict:
    d = spec.day.isoformat()
    head = {
        "objectName": "CreditNote" if credit else "Invoice",
        "mapAll": True,
        "contact": ref(contact_id, "Contact"),
        "discount": 0,
        "addressCountry": ref(COUNTRY_DE, "StaticCountry"),
        "status": 100,
        "contactPerson": ref(user_id, "SevUser"),
        "taxRule": ref(spec.rule, "TaxRule"),
        "currency": "EUR",
        "header": f"{MARKER}{spec.key}",
        "showNet": True,
        # Pflichtfeld im Kopf trotz Buchungsversion 2.0 (belegt: sonst HTTP 400 "tax_rate cannot be null")
        "taxRate": 0 if spec.rule == RULE_SMALL else 19,
        "taxText": "Steuer",
        "taxType": "ss" if spec.rule == RULE_SMALL else "default",
    }
    pos_key = "creditNotePosSave" if credit else "invoicePosSave"
    pos_obj = "CreditNotePos" if credit else "InvoicePos"
    positions = [
        {"objectName": pos_obj, "mapAll": True, "name": nm, "quantity": q, "price": p,
         "taxRate": r, "unity": ref(u, "Unity"), "positionNumber": i}
        for i, (nm, q, p, r, u) in enumerate(spec.positions)
    ]
    if credit:
        head["creditNoteDate"] = d
        head["deliveryDate"] = d  # belegt: sonst HTTP 422 "Must set deliveryDate"
        head["bookingCategory"] = "UNDERACHIEVEMENT"
        return {"creditNote": head, pos_key: positions, "creditNotePosDelete": None}
    head["invoiceDate"] = d
    head["deliveryDate"] = d
    if spec.inv_type == "AR":  # belegt: Abschlagsrechnung verlangt Rechnungsdatum VOR Leistungsdatum
        head["deliveryDate"] = (spec.day + timedelta(days=30)).isoformat()
    head["invoiceType"] = spec.inv_type
    return {"invoice": head, pos_key: positions, "invoicePosDelete": None}


def existing_markers(api: Api) -> dict[str, tuple[str, str, int]]:
    found: dict[str, tuple[str, str, int]] = {}
    for kind, path in (("invoice", "/Invoice"), ("credit", "/CreditNote")):
        offset = 0
        while True:
            d = api.call("GET", f"{path}?limit=1000&offset={offset}")
            objs = d.get("objects", [])
            for o in objs:
                h = o.get("header") or ""
                if h.startswith(MARKER):
                    found[h[len(MARKER):]] = (kind, o["id"], int(o.get("status") or 0))
            if len(objs) < 1000:
                break
            offset += 1000
    return found


def contact_ids(api: Api) -> dict[str, str]:
    out = {}
    for i in range(1, 11):
        cn = f"TP-{i:04d}"
        objs = api.call("GET", f"/Contact?customerNumber={cn}&depth=20").get("objects", [])
        if not objs:
            raise ApiError(f"Testkontakt {cn} fehlt")
        out[cn] = objs[0]["id"]
    return out


def create_credit(api: Api, spec: Spec, origins: list[dict]) -> str:
    """Gutschrift aus einer finalisierten Regel-11-Rechnung. Datum darf nicht vor dem Ursprungsbeleg liegen."""
    origin = origins[int(spec.key.split("-")[1]) % len(origins)]
    created = api.call("POST", "/CreditNote/Factory/createFromInvoice",
                       {"invoice": ref(origin["id"], "Invoice")})["objects"]
    obj = created.get("creditNote", created)
    credit_id = obj["id"]
    day = max(spec.day, date.fromisoformat(origin["invoiceDate"][:10]) + timedelta(days=3)).isoformat()
    try:
        api.call("PUT", f"/CreditNote/{credit_id}", {
            "header": f"{MARKER}{spec.key}", "creditNoteDate": day, "deliveryDate": day})
    except ApiError:
        api.call("DELETE", f"/CreditNote/{credit_id}")  # kein unmarkierter Waise
        raise
    return credit_id


def apply_spec(api: Api, spec: Spec, cid: str, uid: str, check_account: str,
               resume: tuple[str, str, int] | None = None, origins: list[dict] | None = None) -> str:
    """Legt den Beleg an oder setzt einen angefangenen fort (resume = (Art, id, aktueller Status))."""
    credit = spec.kind == "credit"
    base = "/CreditNote" if credit else "/Invoice"
    key = "creditNote" if credit else "invoice"
    if resume:
        obj_id, cur = resume[1], resume[2]
    else:
        if credit:
            obj_id, cur = create_credit(api, spec, origins or []), 100
        else:
            saved = api.call("POST", "/Invoice/Factory/saveInvoice", payload(spec, cid, uid, False))
            obj_id, cur = saved["objects"][key]["id"], 100
    if spec.status == 100:
        return obj_id
    if cur == 100:  # belegt: changeStatus entfällt mit Update 2.0, sendBy setzt Status 200
        api.call("PUT", f"{base}/{obj_id}/sendBy", {"sendType": "VPR", "sendDraft": False})
        cur = 200
    if spec.status in (750, 1000) and cur == 200:
        total = float(api.call("GET", f"{base}/{obj_id}")["objects"][0]["sumGross"])
        amount = total if spec.status == 1000 else round(total * spec.paid_fraction, 2)
        pay_day = (spec.day + timedelta(days=14)).isoformat()
        api.call("PUT", f"{base}/{obj_id}/bookAmount", {
            "amount": amount, "date": pay_day, "type": "N",
            "checkAccount": ref(check_account, "CheckAccount"), "checkAccountTransaction": None,
        })
    return obj_id


def purge(api: Api) -> None:
    for key, (kind, oid, _st) in existing_markers(api).items():
        base = "/CreditNote" if kind == "credit" else "/Invoice"
        try:
            api.call("DELETE", f"{base}/{oid}")
            print(f"gelöscht {kind} {key}")
        except ApiError as e:
            print(f"übersprungen {kind} {key}: {e}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="wirklich schreiben (sonst Dry-Run)")
    ap.add_argument("--limit", type=int, default=0, help="nur die ersten N Belege")
    ap.add_argument("--purge", action="store_true", help="alle Belege mit Marker löschen")
    args = ap.parse_args()

    api = Api()
    if args.purge:
        purge(api)
        return 0

    plan = build_plan()
    if args.limit:
        plan = plan[: args.limit]
    counts: dict[str, int] = {}
    for s in plan:
        k = f"{s.kind}/{s.inv_type or '-'}/{s.status}"
        counts[k] = counts.get(k, 0) + 1
    print(f"Plan: {len(plan)} Belege")
    for k, v in sorted(counts.items()):
        print(f"  {k}: {v}")
    if not args.apply:
        print("Dry-Run, nichts geschrieben. Mit --apply ausführen.")
        return 0

    uid = api.call("GET", "/SevUser")["objects"][0]["id"]
    ca = api.call("GET", "/CheckAccount")["objects"][0]["id"]
    cids = contact_ids(api)
    done = existing_markers(api)
    inv = api.call("GET", "/Invoice?limit=1000")["objects"]
    origins = sorted((o for o in inv if (o.get("header") or "").startswith(MARKER) and o["taxRule"]["id"] == "11"
                      and o["invoiceType"] == "RE" and o["status"] in ("200", "750", "1000")),
                     key=lambda o: o["id"])
    ok = fail = skipped = 0
    for s in plan:
        have = done.get(s.key)
        if have and (s.status == 100 or have[2] != 100):
            skipped += 1
            continue
        try:
            apply_spec(api, s, cids[s.contact], uid, ca, resume=have, origins=origins)
            ok += 1
        except ApiError as e:
            fail += 1
            print(f"FEHLER {s.key}: {e}", file=sys.stderr)
    print(f"angelegt {ok}, übersprungen {skipped}, Fehler {fail}, "
          f"API-Aufrufe {api.calls}, HTTP 429: {api.rate_limited}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
