# claude-sevdesk-connector

Ein MCP-Connector, mit dem Claude Rechnungen, Gutschriften, Kunden und Auswertungen aus **sevDesk** lesen kann. Gebaut von [m-ko.de](https://m-ko.de), Schwesterprojekt des [Lexware-Office-Connectors](https://github.com/muka-dev/claude-lexware-office-connector).

- **Nur lesend.** Der Connector sendet ausschließlich GET-Anfragen. Es werden keine Belege angelegt, geändert oder finalisiert.
- **Läuft lokal.** Der API-Token geht nur an die sevDesk-API. Es gibt keinen Server von m-ko.de dazwischen.
- **Standardmäßig datensparsam.** Namen werden durch Platzhalter ersetzt, Adressen und Steuer-IDs entfernt, kleine Gruppen ausgeblendet.
- **Kostenlos, MIT-lizenziert.**

> **Status: Prototyp (v0.1).** Getestet an einem sevDesk-Testkonto (Kleinunternehmer, rund 60 Testbelege). Noch nicht auf npm veröffentlicht. Stornorechnungen sind noch nicht berücksichtigt (geplant für v0.3).

> **Wichtig:** Was Claude aus dem Connector erhält, geht an den Modell-Anbieter, sobald Claude es verarbeitet. Der Connector verringert, was dabei an Personendaten übertragen wird. Er macht die Daten nicht anonym. Details: [docs/SECURITY-PRIVACY.md](docs/SECURITY-PRIVACY.md).

## Inhalt

- [Schnellstart](#schnellstart)
- [Konfiguration](#konfiguration)
- [Was der Connector kann](#was-der-connector-kann)
- [Datenschutz in Kürze](#datenschutz-in-kürze)
- [Grenzen](#grenzen)
- [Entwicklung und Tests](#entwicklung-und-tests)
- [Weitere Dokumentation](#weitere-dokumentation)

## Schnellstart

Benötigt werden **Node.js 22 oder neuer** und ein **sevDesk-API-Token**.

1. **API-Token holen:** In sevDesk in den Benutzereinstellungen (die Bezeichnung kann je nach Version abweichen). Der Token gehört zu einem Benutzer und wird wie ein Passwort behandelt. Ob sich ein Token auf Lesezugriff beschränken lässt, ist nicht belegt. Der Connector selbst liest nur.
2. **Bauen** (solange das Paket nicht auf npm liegt):

   ```bash
   git clone https://github.com/muka-dev/claude-sevdesk-connector.git
   cd claude-sevdesk-connector
   npm install && npm run build
   ```

3. **Claude Desktop einrichten.** Ein Eintrag in `claude_desktop_config.json`, anschließend Claude Desktop neu starten:

   ```json
   {
     "mcpServers": {
       "sevdesk": {
         "command": "node",
         "args": ["/PFAD/ZU/claude-sevdesk-connector/dist/main.js"],
         "env": { "SEVDESK_TOKEN": "API_TOKEN" }
       }
     }
   }
   ```

4. **Oder mit Claude Code:**

   ```bash
   claude mcp add --env SEVDESK_TOKEN=API_TOKEN sevdesk -- node /PFAD/ZU/claude-sevdesk-connector/dist/main.js
   ```

5. **Ausprobieren:** Zum Beispiel „Welche Rechnungen sind überfällig?“ oder „Wie hat sich der Umsatz im ersten Quartal entwickelt?“.

Die Verbindung steht, wenn in der Tool-Liste die Tools `sevdesk_*` erscheinen. Sonst hilft [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Konfiguration

Nur `SEVDESK_TOKEN` ist Pflicht. Die Variablen werden beim Start gelesen, nach einer Änderung muss die Anwendung neu starten.

| Variable | Standard | Wirkung |
|---|---|---|
| `SEVDESK_TOKEN` | – | Pflicht. Der API-Token. Ohne ihn startet der Connector nicht. |
| `SEVDESK_REDACT` | an | Namen werden zu Platzhaltern (`Kontakt 1`), Adressfelder und Steuer-IDs entfernt. `0`, `false`, `no` oder `off` schaltet es ab. |
| `SEVDESK_MIN_GROUP` | `5` | Mindestzahl verschiedener Kunden, damit eine Auswertung angezeigt wird. `1` schaltet die Schwelle aus. Ungültige Werte fallen auf `5` zurück. |

## Was der Connector kann

Die vollständige Referenz steht in [docs/API.md](docs/API.md).

| Bereich | Tools |
|---|---|
| Stammdaten | `sevdesk_search_contacts` |
| Belege | `sevdesk_list_invoices`, `sevdesk_get_invoice` |
| Auswertungen | `sevdesk_open_items`, `sevdesk_revenue_by_month`, `sevdesk_customer_concentration`, `sevdesk_vat_summary` |

In Umsatz und Konzentration zählen Rechnungen der Typen RE und ER mit Status offen, teilbezahlt oder bezahlt, abzüglich Gutschriften. Entwürfe, Mahnungen, Teil- und Abschlagsrechnungen sind ausgenommen.

## Datenschutz in Kürze

| Was | Standard |
|---|---|
| Belegdaten | Whitelist: Nummer, Typ, Status, Datum, Beträge, Kontakt-ID. Adressen und Freitext werden nicht übernommen. |
| Namen | Platzhalter (`Kontakt 1`), je Prozess stabil |
| Adressen, Steuer-IDs, Bankdaten | entfernt |
| Freitext | E-Mail, IBAN, Telefon und USt-IdNr. ersetzt |
| Kleine Gruppen | ausgeblendet (unter fünf Kunden) |
| Speicherung | keine. Pseudonyme und Cache nur im Arbeitsspeicher. Keine Logdateien, keine Telemetrie. |

Details und bekannte Lücken: [docs/SECURITY-PRIVACY.md](docs/SECURITY-PRIVACY.md).

## Grenzen

- **Stornorechnungen (SR)** sind ausgeschlossen, jede Auswertung weist darauf hin. Umsetzung in v0.3.
- **Gutschriften** haben kein `paidAmount` und erreichen in sevDesk auch bei voller Buchung nur Status „teilweise bezahlt“. Sie mindern den Umsatz in allen Statusstufen außer Entwurf.
- **Zahlungsziel:** Fehlt es an der Rechnung, nimmt der Connector 14 Tage an und sagt das in der Auswertung.
- **Kleinunternehmer-Konten:** Die Auswertung erkennt sie nicht allein am Belegfeld `smallSettlement`. Die USt-Übersicht zeigt, was an den Positionen steht.
- **USt-Übersicht:** Eine Vorbereitungshilfe, keine steuerliche Beurteilung. Sie ruft je Rechnung die Positionen ab, ist deshalb langsam und auf 200 Rechnungen je Aufruf begrenzt.
- **Ratenlimit:** Das Limit von sevDesk ist nicht dokumentiert. Der Connector wiederholt bei HTTP 429 mit Wartezeit.
- **Freitext-Namen** in Notizen werden nicht erkannt. Beträge, Daten und Belegnummern bleiben sichtbar und können bei kleinen Kundenstämmen auf eine Firma hinweisen.
- **Keine Zusicherung** zu Zertifizierung, Garantien oder rechtlicher Konformität.

## Entwicklung und Tests

```bash
npm install
npm test          # Unit-Tests, ohne API und ohne Netz
npm run typecheck
npm run build
```

Die CI führt Typprüfung, Tests und Build bei jedem Pull Request aus ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Die Teststrategie steht in [docs/TESTING.md](docs/TESTING.md).

### Live-Check gegen ein Testkonto

`scripts/live-check.mjs` führt alle Tools lesend gegen die echte API aus und gibt nur Aggregate aus.

```bash
npm run build
SEVDESK_TOKEN=... node scripts/live-check.mjs 2026-01-01 2026-12-31
```

`testdata/` enthält den Generator für Testkontakte und Testbelege (`generate_invoices.py`, Dry-Run als Standard). Der Generator schreibt ins Konto und gehört nur an ein Testkonto.

## Weitere Dokumentation

- [docs/API.md](docs/API.md): Tool-Referenz mit Parametern und Antwortformen
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Aufbau, Datenfluss und Entscheidungen
- [docs/SECURITY-PRIVACY.md](docs/SECURITY-PRIVACY.md): Datenflüsse, Schutzmaßnahmen und Lücken
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): Fehlerbilder und Lösungen
- [docs/DESIGN.md](docs/DESIGN.md): Systemdesign mit Belegstatus und API-Befunden
- [docs/TESTING.md](docs/TESTING.md): Teststrategie

## Lizenz

MIT, siehe [LICENSE](LICENSE).

sevDesk ist eine Marke der sevDesk GmbH. Dieses Projekt ist nicht mit sevDesk verbunden.
