# claude-sevdesk-connector

[![npm](https://img.shields.io/npm/v/claude-sevdesk-connector?color=12332E)](https://www.npmjs.com/package/claude-sevdesk-connector)
[![CI](https://github.com/muka-dev/claude-sevdesk-connector/actions/workflows/ci.yml/badge.svg)](https://github.com/muka-dev/claude-sevdesk-connector/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-12332E)](LICENSE)
[![Node.js ab 22](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-12332E)](https://nodejs.org)

**Ein MCP-Connector, mit dem Claude Rechnungen, Gutschriften, Kunden und Auswertungen aus [sevDesk](https://sevdesk.de) lesen kann.**
Gebaut von [m-ko.de](https://m-ko.de), Schwesterprojekt des [Lexware-Office-Connectors](https://www.npmjs.com/package/claude-lexware-office-connector).

| | |
|---|---|
| **Nur lesend** | Es werden ausschließlich GET-Anfragen gesendet. Nichts wird angelegt, geändert oder finalisiert. |
| **Lokal** | Der API-Token geht nur an die sevDesk-API. Es gibt keinen Server von m-ko.de dazwischen. |
| **Datensparsam** | Namen werden zu Platzhaltern, Adressen und Steuer-IDs entfernt, kleine Gruppen ausgeblendet. |
| **Frei** | Kostenlos und MIT-lizenziert. Die Pakete tragen eine Herkunftsangabe (Provenance). |

> **Stand: Version 0.1, an einem sevDesk-Testkonto geprüft.** Stornorechnungen sind noch nicht berücksichtigt (geplant für 0.3).
>
> **Wichtig:** Was Claude aus dem Connector erhält, geht an den Modell-Anbieter, sobald Claude es verarbeitet. Der Connector verringert, was dabei an Personendaten übertragen wird. Er macht die Daten nicht anonym. Details: [docs/SECURITY-PRIVACY.md](docs/SECURITY-PRIVACY.md).

## Schnellstart

Benötigt werden **Node.js 22 oder neuer** und ein **sevDesk-API-Token**.

**1. Token holen.** In sevDesk in den Benutzereinstellungen (die Bezeichnung kann je nach Version abweichen). Der Token gehört zu einem Benutzer und wird wie ein Passwort behandelt. Ob sich ein Token auf Lesezugriff beschränken lässt, ist nicht belegt. Der Connector selbst liest nur.

**2. Claude einrichten.**

Claude Desktop, Eintrag in `claude_desktop_config.json`, danach neu starten:

```json
{
  "mcpServers": {
    "sevdesk": {
      "command": "npx",
      "args": ["-y", "claude-sevdesk-connector"],
      "env": { "SEVDESK_TOKEN": "API_TOKEN" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --env SEVDESK_TOKEN=API_TOKEN sevdesk -- npx -y claude-sevdesk-connector
```

**3. Ausprobieren.** Die Verbindung steht, wenn in der Tool-Liste die Tools `sevdesk_*` erscheinen. Sonst hilft [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Beispiele

| Frage an Claude | Tool |
|---|---|
| „Welche Rechnungen sind überfällig?“ | `sevdesk_open_items` |
| „Wie hat sich der Umsatz im ersten Quartal entwickelt?“ | `sevdesk_revenue_by_month` |
| „Wie stark hängt der Umsatz von wenigen Kunden ab?“ | `sevdesk_customer_concentration` |
| „Erstelle eine USt-Übersicht für das Quartal.“ | `sevdesk_vat_summary` |

## Tools

Die vollständige Referenz mit Parametern und Antwortformen steht in [docs/API.md](docs/API.md).

| Bereich | Tools |
|---|---|
| Stammdaten | `sevdesk_search_contacts` |
| Belege | `sevdesk_list_invoices`, `sevdesk_get_invoice` |
| Auswertungen | `sevdesk_open_items`, `sevdesk_revenue_by_month`, `sevdesk_customer_concentration`, `sevdesk_vat_summary` |

In Umsatz und Konzentration zählen Rechnungen der Typen RE und ER mit Status offen, teilbezahlt oder bezahlt, abzüglich Gutschriften. Entwürfe, Mahnungen, Teil- und Abschlagsrechnungen sind ausgenommen.

## Konfiguration

Nur `SEVDESK_TOKEN` ist Pflicht. Die Variablen werden beim Start gelesen, nach einer Änderung muss die Anwendung neu starten.

| Variable | Standard | Wirkung |
|---|---|---|
| `SEVDESK_TOKEN` | – | Pflicht. Der API-Token. Ohne ihn startet der Connector nicht. |
| `SEVDESK_REDACT` | an | Namen werden zu Platzhaltern (`Kontakt 1`), Adressfelder und Steuer-IDs entfernt. `0`, `false`, `no` oder `off` schaltet es ab. |
| `SEVDESK_MIN_GROUP` | `5` | Mindestzahl verschiedener Kunden, damit eine Auswertung angezeigt wird. `1` schaltet die Schwelle aus. Ungültige Werte fallen auf `5` zurück. |

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

- **Stornorechnungen (SR)** sind ausgeschlossen, jede Auswertung weist darauf hin.
- **Gutschriften** haben kein `paidAmount` und erreichen in sevDesk auch bei voller Buchung nur Status „teilweise bezahlt“. Sie mindern den Umsatz in allen Statusstufen außer Entwurf.
- **Zahlungsziel:** Fehlt es an der Rechnung, nimmt der Connector 14 Tage an und sagt das in der Auswertung.
- **Kleinunternehmer-Konten** werden nicht allein am Belegfeld `smallSettlement` erkannt. Die USt-Übersicht zeigt, was an den Positionen steht.
- **USt-Übersicht:** Eine Vorbereitungshilfe, keine steuerliche Beurteilung. Sie ruft je Rechnung die Positionen ab, ist deshalb langsam und auf 200 Rechnungen je Aufruf begrenzt.
- **Ratenlimit:** Das Limit von sevDesk ist nicht dokumentiert. Der Connector wiederholt bei HTTP 429 mit Wartezeit.
- **Freitext-Namen** in Notizen werden nicht erkannt. Beträge, Daten und Belegnummern bleiben sichtbar und können bei kleinen Kundenstämmen auf eine Firma hinweisen.
- **Keine Zusicherung** zu Zertifizierung, Garantien oder rechtlicher Konformität.

## Entwicklung

```bash
git clone https://github.com/muka-dev/claude-sevdesk-connector.git
cd claude-sevdesk-connector
npm install
npm test          # Unit-, Replay- und Protokolltests mit Coverage-Schwellen, ohne API und ohne Netz
npm run typecheck
npm run build     # erzeugt dist/main.js, lokal startbar mit: SEVDESK_TOKEN=... node dist/main.js
```

Live-Check gegen ein Testkonto, nur lesend, mit Ausgabe von Aggregaten:

```bash
SEVDESK_TOKEN=... node scripts/live-check.mjs 2026-01-01 2026-12-31
```

`testdata/` enthält den Generator für Testkontakte und Testbelege (`generate_invoices.py`, Dry-Run als Standard). Der Generator schreibt ins Konto und gehört nur an ein Testkonto.

## Dokumentation

| | |
|---|---|
| [docs/API.md](docs/API.md) | Tool-Referenz mit Parametern und Antwortformen |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Aufbau, Datenfluss und Entscheidungen |
| [docs/SECURITY-PRIVACY.md](docs/SECURITY-PRIVACY.md) | Datenflüsse, Schutzmaßnahmen und Lücken |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Fehlerbilder und Lösungen |
| [docs/DESIGN.md](docs/DESIGN.md) | Systemdesign mit Belegstatus und API-Befunden |
| [docs/TESTING.md](docs/TESTING.md) | Teststrategie |
| [docs/RELEASING.md](docs/RELEASING.md) | Veröffentlichen auf npm, Zugang und geplante Umstellung |

Mehr dazu auf [m-ko.de/connectors/sevdesk](https://m-ko.de/connectors/sevdesk/).

## Lizenz

MIT, siehe [LICENSE](LICENSE).

sevDesk ist eine Marke der sevDesk GmbH. Dieses Projekt ist nicht mit sevDesk verbunden.
