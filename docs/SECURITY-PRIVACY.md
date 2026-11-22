# Sicherheit und Datenschutz

Diese Seite beschreibt Datenflüsse und Schutzmaßnahmen. Sie ist keine Rechtsberatung und enthält keine Zusicherung zu Zertifizierung, Garantien oder rechtlicher Konformität.

## Datenfluss

1. Der Connector läuft als Prozess auf dem Rechner, auf dem Claude läuft. Es gibt keinen Server von m-ko.de dazwischen.
2. Er ruft `https://my.sevdesk.de/api/v1` mit dem Token auf. Das Token verlässt den Rechner nur in Richtung sevDesk.
3. Das Ergebnis geht über stdio an Claude. **Von dort an liegt es beim Modell-Anbieter**, soweit Claude es verarbeitet. Der Connector verringert Personendaten in diesem Ergebnis, er anonymisiert nicht.

## Token

- Der Token gehört zu einem sevDesk-Benutzer. Ob er sich auf Lesezugriff beschränken lässt, ist nicht belegt. Der Connector sendet ausschließlich GET.
- Der Token steht nur in der Umgebungsvariable `SEVDESK_TOKEN`. Er wird nicht protokolliert und nicht in Fehlermeldungen ausgegeben.
- Fehlermeldungen enthalten nur Status und Pfad, nie den Antworttext der API (er kann Kontodaten enthalten).
- Der Konto-Endpunkt `GET /SevClient` wird nicht verwendet: Er enthält die Login-E-Mail und Kontodaten.

## Schutzmaßnahmen

| Maßnahme | Wirkung |
|---|---|
| Whitelist-Mapper | Belege übertragen nur Nummer, Typ, Status, Datum, Beträge, Zahlungsziel und Kontakt-ID. Adressen, Kopf- und Fußtexte bleiben im Connector. |
| Pseudonyme | Namen (`name`, `surename`, `familyname`, `name2`) werden zu `Kontakt n`, stabil innerhalb eines Prozesses. |
| Entfernen | Straße, PLZ, Steuernummer, USt-IdNr., Bankfelder werden durch `[entfernt]` ersetzt. |
| Freitext | E-Mail, IBAN, USt-IdNr. und Telefonnummern werden in allen Texten ersetzt. |
| Mindestgruppe | Unter fünf verschiedenen Kunden wird eine Auswertung unterdrückt (`SEVDESK_MIN_GROUP`). |
| Keine Speicherung | Pseudonyme und Cache liegen nur im Arbeitsspeicher. Keine Logdateien, keine Telemetrie. |

## Bekannte Lücken

- **Namen im Freitext** (Notizen, Beschreibungen) werden nicht erkannt. Belegtexte und Kontakt-Beschreibungen werden von den Tools nicht ausgegeben.
- **Kontakt-IDs, Belegnummern, Daten und Beträge** bleiben sichtbar. Bei kleinen Kundenstämmen können sie zusammen auf eine Firma hinweisen.
- **Pseudonyme sind keine Anonymisierung** im rechtlichen Sinn. Pseudonymisierte Daten bleiben personenbezogen.
- **Auftragsverarbeitung:** Ob und wie Daten an den Modell-Anbieter übermittelt werden dürfen, ist vor dem Einsatz mit echten Kundendaten zu klären. Das ist nicht Teil des Connectors.

## Testkonto statt Echtdaten

Entwicklung und Tests nutzen ein Testkonto mit erfundenen Daten. Echte Kundendaten gehören nicht in Tests, Fixtures oder Issues. Das Token des Testkontos liegt nie im Repository.
