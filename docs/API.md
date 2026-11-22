# Tool-Referenz

Alle Tools sind nur lesend. Datumsangaben im Format `yyyy-MM-dd`. Ohne `from` und `to` gilt das laufende Jahr bis heute. Fehler kommen als Ergebnis mit `isError` zurück, die Meldung enthält nie den Antworttext der API.

Beträge sind Bruttobeträge in der Belegwährung, als Zahl. Status: `100` Entwurf, `200` offen, `750` teilweise bezahlt, `1000` bezahlt.

## sevdesk_search_contacts

Sucht Kunden nach Name oder Kundennummer. `GET /Contact` braucht `depth=20`, sonst fehlen Personen. Der Namensfilter der API ist nicht verlässlich, deshalb wird lokal gefiltert (höchstens 25 Treffer).

| Parameter | Typ | Bedeutung |
|---|---|---|
| `query` | string, optional | Teilstring in Name, Vorname, Nachname oder Kundennummer |
| `customerNumber` | string, optional | exakte Kundennummer (Filter an der API) |

Antwort: Liste mit `id`, `customerNumber`, `category`, `name`, `surename`, `familyname`. Namen sind bei aktiver Redaktion Platzhalter.

## sevdesk_list_invoices

Rechnungen und Gutschriften im Zeitraum.

| Parameter | Typ | Bedeutung |
|---|---|---|
| `from`, `to` | Datum, optional | Zeitraum nach Belegdatum |
| `status` | Zahl, optional | nur diesen Status |

Antwort: Liste mit `id`, `kind` (`invoice` oder `credit`), `type` (Rechnungstyp RE, ER, TR, AR, SR, MA, WKR), `status`, `number`, `date`, `timeToPay` (Tage oder `null`), `gross`, `paid` (bei Gutschriften `null`), `contactId`.

## sevdesk_get_invoice

Eine Rechnung mit Positionen.

| Parameter | Typ | Bedeutung |
|---|---|---|
| `id` | string (nur Ziffern) | sevDesk-ID der Rechnung |

Antwort: wie ein Eintrag aus `sevdesk_list_invoices`, dazu `positions` mit `taxRate`, `net`, `tax` je Position.

## sevdesk_open_items

Offene Posten nach Tagen über Fälligkeit. Nur Rechnungen der Typen RE und ER mit Status 200 oder 750. Restbetrag = Brutto minus `paidAmount`. Fälligkeit = Belegdatum plus Zahlungsziel (14 Tage, wenn keins gesetzt ist).

Parameter: `from`, `to`. Antwort: `buckets` mit `notDue`, `1-30`, `31-60`, `61-90`, `over90`, je `total` und `count`; dazu `notes`. Eine Gruppe mit weniger als der Mindestzahl Kunden erscheint als `{"total": null, "count": null, "suppressed": true}`.

## sevdesk_revenue_by_month

Bruttoumsatz je Kalendermonat. Rechnungen RE und ER mit Status 200, 750, 1000, abzüglich Gutschriften (ebenfalls 200, 750, 1000). Ausgenommen: Entwürfe, Mahnungen (MA), Teil- (TR) und Abschlagsrechnungen (AR), Stornorechnungen (SR).

Parameter: `from`, `to`. Antwort: `months` (`month`, `gross`, `count`, bei kleinen Gruppen `suppressed`), `unknownStatusCount` (Belege mit unbekanntem Status, in keiner Summe) und `note` zu Stornorechnungen.

## sevdesk_customer_concentration

Wie stark der Umsatz an wenigen Kunden hängt. Liefert die Zahl der Kunden und die Anteile der drei größten als Zehnerbänder (zum Beispiel `30–40 %`). Keine Namen, keine Beträge.

Parameter: `from`, `to`. Antwort: `customerCount`, `topShares` (`rank`, `shareBand`), `note`. Unter der Mindestgruppe: `suppressed: true`.

## sevdesk_vat_summary

Netto und Steuer je Steuersatz, aus den Positionen der Rechnungen (RE, ER; Status 200, 750, 1000). Ruft je Rechnung `GET /InvoicePos` ab, nacheinander und je Sitzung gecacht. Mehr als 200 Rechnungen je Aufruf ergeben einen Fehler, dann den Zeitraum verkleinern.

Parameter: `from`, `to`. Antwort: `rates` (`taxRate`, `net`, `tax`) und `invoicesWithoutPositions` (`count`, `numbers`). Sie ist eine Vorbereitungshilfe, keine steuerliche Beurteilung.
