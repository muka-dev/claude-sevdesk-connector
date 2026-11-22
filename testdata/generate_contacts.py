#!/usr/bin/env python3
"""Erzeugt eine CSV mit fiktiven Kontakten für den sevDesk-Testaccount.

Alle Daten sind erfunden. Firmennamen tragen das Präfix "Testfirma", E-Mail-
Adressen verwenden die reservierte Domain example.com, USt-IdNr. und
Steuernummern haben ein erkennbares Muster und sind keine echten Nummern.

Aufruf:  python3 testdata/generate_contacts.py
Ergebnis: testdata/contacts-import.csv (UTF-8 mit BOM, Trennzeichen ";")
"""

import csv
import random
from pathlib import Path

SEED = 20260101
ROWS_ORG = 150
ROWS_PERSON = 90
OUT = Path(__file__).resolve().parent / "contacts-import.csv"

HEADER = [
    "Kundennummer",
    "Organisation",
    "Vorname",
    "Nachname",
    "Kategorie",
    "Strasse",
    "PLZ",
    "Ort",
    "Land",
    "E-Mail",
    "Telefon",
    "USt-IdNr",
    "Steuernummer",
    "Notiz",
]

FIRST = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Hannes",
         "Ilse", "Jonas", "Karla", "Lukas", "Mila", "Nico", "Ole", "Petra",
         "Quirin", "Rita", "Sven", "Tilda", "Uwe", "Vera", "Walter", "Yara",
         "Zoe", "Jürgen", "Sören", "Ayşe", "Björn", "Gülcan"]
LAST = ["Testmann", "Probst", "Beispiel", "Musterer", "Demo", "Kalt",
        "Lindqvist", "Ostermann", "Hügel", "Schäfer-Test", "Dreher",
        "Zwick", "Brandl", "Fuchs", "Wendt", "Ilgaz", "Krämer", "Stahl",
        "Ebner", "Pfeiffer", "Ludwig", "Haas", "Ruppert", "Mertens"]
TRADE = ["Holzbau", "Elektro", "Gartenpflege", "Druckerei", "Software",
         "Catering", "Logistik", "Fotostudio", "Malerbetrieb", "Beratung",
         "Immobilien", "Metallbau", "Reinigung", "Bäckerei", "Werbeagentur",
         "IT-Service", "Fahrschule", "Physiotherapie", "Glaserei", "Tierklinik"]
LEGAL = ["GmbH", "UG (haftungsbeschränkt)", "e.K.", "GbR", "KG", "AG"]
STREETS = ["Musterweg", "Beispielstraße", "Testgasse", "Probeallee",
           "Dummyring", "Fiktivplatz", "Platzhalterweg", "Scheinstraße"]
CITIES = [("10115", "Berlin"), ("20095", "Hamburg"), ("80331", "München"),
          ("50667", "Köln"), ("60311", "Frankfurt am Main"),
          ("70173", "Stuttgart"), ("01067", "Dresden"), ("30159", "Hannover"),
          ("90402", "Nürnberg"), ("44135", "Dortmund"), ("04109", "Leipzig"),
          ("53111", "Bonn"), ("40213", "Düsseldorf"), ("28195", "Bremen")]

# Randfälle: Umlaute, Sonderzeichen, Anführungszeichen, Semikolon im Feld,
# fehlende Angaben, sehr langer Name. Sie prüfen Import und Mapper.
EDGE = [
    {"Organisation": "Testfirma Müller & Söhne \"Die Erste\" GmbH", "Kategorie": "Kunde",
     "Ort": "Lübeck", "PLZ": "23552", "Notiz": "Feld mit Semikolon; und Komma, Test"},
    {"Organisation": "Testfirma Straßenbau Größe GmbH", "Kategorie": "Kunde",
     "Ort": "Göttingen", "PLZ": "37073", "E-Mail": ""},
    {"Organisation": "", "Vorname": "Ökonomie", "Nachname": "Müßig-Probe",
     "Kategorie": "Kunde", "Ort": "Freiburg", "PLZ": "79098"},
    {"Organisation": "Testfirma " + "Lange-Bezeichnung-" * 6 + "GmbH", "Kategorie": "Kunde",
     "Ort": "Potsdam", "PLZ": "14467"},
    {"Organisation": "Testfirma Lieferant Beispiel e.K.", "Kategorie": "Lieferant",
     "Ort": "Kiel", "PLZ": "24103", "Telefon": "", "USt-IdNr": ""},
]


def vat_id(rng):
    return "DE9" + "".join(str(rng.randint(0, 9)) for _ in range(8))


def tax_no(rng):
    return f"{rng.randint(10, 99)}/{rng.randint(100, 999)}/{rng.randint(10000, 99999)}"


def phone(rng):
    return f"+49 000 {rng.randint(1000000, 9999999)}"


def build_rows(rng):
    rows = []
    n = 0
    for i in range(ROWS_ORG):
        n += 1
        zip_, city = rng.choice(CITIES)
        org = f"Testfirma {i + 1:03d} {rng.choice(TRADE)} {rng.choice(LEGAL)}"
        rows.append({
            "Kundennummer": f"TK-{n:05d}",
            "Organisation": org,
            "Vorname": "",
            "Nachname": "",
            "Kategorie": "Lieferant" if i % 9 == 8 else "Kunde",
            "Strasse": f"{rng.choice(STREETS)} {rng.randint(1, 120)}",
            "PLZ": zip_,
            "Ort": city,
            "Land": "Deutschland",
            "E-Mail": f"info{i + 1:03d}@example.com",
            "Telefon": phone(rng),
            "USt-IdNr": vat_id(rng) if i % 3 else "",
            "Steuernummer": tax_no(rng),
            "Notiz": "",
        })
    for i in range(ROWS_PERSON):
        n += 1
        zip_, city = rng.choice(CITIES)
        first, last = rng.choice(FIRST), rng.choice(LAST)
        rows.append({
            "Kundennummer": f"TK-{n:05d}",
            "Organisation": "",
            "Vorname": first,
            "Nachname": last,
            "Kategorie": "Kunde",
            "Strasse": f"{rng.choice(STREETS)} {rng.randint(1, 120)}",
            "PLZ": zip_,
            "Ort": city,
            "Land": "Deutschland",
            "E-Mail": f"{first.lower()}.{i + 1:03d}@example.com".replace("ü", "ue").replace("ö", "oe")
                      .replace("ä", "ae").replace("ß", "ss").replace("ç", "c").replace("ı", "i")
                      .replace("ş", "s").replace("ğ", "g"),
            "Telefon": phone(rng),
            "USt-IdNr": "",
            "Steuernummer": "",
            "Notiz": "Privatkunde, Testdatensatz",
        })
    for e in EDGE:
        n += 1
        base = {k: "" for k in HEADER}
        base.update({"Kundennummer": f"TK-{n:05d}", "Land": "Deutschland",
                     "Strasse": "Musterweg 1", "E-Mail": f"edge{n}@example.com",
                     "Telefon": phone(rng)})
        base.update(e)
        rows.append(base)
    return rows


def main():
    rng = random.Random(SEED)
    rows = build_rows(rng)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=HEADER, delimiter=";",
                           quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} Kontakte geschrieben: {OUT}")


if __name__ == "__main__":
    main()
