# Teststrategie: claude-sevdesk-connector (v0.1)

Stand: umgesetzt für v0.1 (107 Tests, Coverage-Schwellen aktiv). Grundlage ist [DESIGN.md](DESIGN.md). Der Umfang entspricht dem Lexware-Connector ohne Storno, Storno kommt in v0.3.

## 1. Ziele

1. Keine Personendaten im Ergebnis, die nicht über die Whitelist erlaubt sind.
2. Keine falschen Summen: Umsatz, offene Posten und USt müssen mit einem unabhängigen Referenzwert übereinstimmen.
3. Vollständigkeit: Ein Abruf liefert alle Belege oder meldet die Lücke, nie still weniger.
4. Fehler ohne Geheimnisse: Token und Antworttext erscheinen in keiner Meldung.

## 2. Testpyramide für diesen Connector

```
           Live (manuell)        Testkonto, lesend, selten
        Integration (HTTP-Replay) Client + Mapper + Tools gegen aufgezeichnete Antworten
     Unit (viele, schnell)        Mapper, Analytics, Redaktion, Client mit gefälschtem fetch
```

| Ebene | Module | Werkzeug | Läuft in |
|---|---|---|---|
| Unit | `mapper.ts`, `analytics/`, `redact/`, `client.ts` (gefälschtes `fetch`) | Vitest | jedem Build |
| Integration | Client, Mapper und Tools gegen Replay-Server mit Phase-0-Antworten | Vitest, lokaler HTTP-Server | jedem Build |
| Protokoll | MCP-Server über In-Memory-Transport, Tool-Liste, Schemata | Vitest | jedem Build |
| Live (manuell) | `scripts/live-check.mjs` gegen Testkonto | Node, Token aus Umgebung | nur lokal, vom Nutzer |

Ohne Token und ohne Netz laufen alle automatischen Tests. Der Live-Check bricht ohne Token ab.

## 3. Testfälle je Bereich

### 3.1 Client (`src/sevdesk/client.ts`)

| Fall | Prüfung | Typ |
|---|---|---|
| Auth-Header ohne Präfix | Header `Authorization` enthält genau den Token, kein `Bearer` | Unit |
| Paging, drei Seiten | `offset` wächst um `limit`, Abbruch bei letzter Seite | Unit + Integration |
| Paging nicht unterstützt (V4 negativ) | Liste wird als unvollständig markiert, kein stilles Kürzen | Unit |
| 429 mit `Retry-After` | Wiederholung nach der angegebenen Zeit, höchstens drei Versuche | Unit (gefälschtes `sleep`) |
| 429 ohne Header | Exponentielles Backoff | Unit |
| 401 | Meldung ohne Token, Status und Pfad | Unit |
| Netzfehler | Meldung ohne vollständige URL mit Filterwerten | Unit |
| Geheimnis in Fehlerpfad | Kein Teil des Tokens in Fehlerobjekt oder Log | Unit, Property |
| `limit` außerhalb 1..1000 | Eingabe wird vor dem Aufruf abgelehnt | Unit |

### 3.2 Mapper (`src/sevdesk/mapper.ts`)

| Fall | Prüfung | Typ |
|---|---|---|
| Whitelist | Jedes Feld der Fixture, das nicht in der Whitelist steht, fehlt im Ergebnis | Unit, Property |
| Verworfene Felder bei `SEVDESK_REDACT=0` | `customerInternalNote`, `bankAccount`, `taxNumber`, `vatNumber` bleiben draußen | Unit |
| Rechnungsstatus | 50, 100, 200, 750, 1000 werden auf die internen Stufen abgebildet, Unbekanntes als `unknown` | Unit, Tabelle |
| Gutschriftsstatus | 100, 200, 750, 1000 normal, 300 und 500 als `unknown` | Unit, Tabelle |
| Rechnungstyp | RE und ER als Umsatz, TR, AR, WKR, MA und SR ausgeschlossen | Unit, Tabelle |
| Betrag | Zahl wird übernommen, Zeichenkette oder `null` wird abgelehnt und nicht als 0 gewertet | Unit |
| Datum | Timestamp wird zu `yyyy-MM-dd`, Sekunden- und Millisekunden-Format werden unterschieden (V6) | Unit |
| Steuermodus 1.0 und 2.0 | `taxType`/`taxSet` und `taxRule` führen zum gleichen internen Ergebnis | Unit |
| Kleinunternehmer | `smallSettlement: true` markiert die Rechnung, USt wird nicht ausgewiesen | Unit |
| Teilzahlung ohne `paidAmount` | Status 200 mit Hinweis, Restbetrag nicht berechnet | Unit |

### 3.3 Analytics (`src/analytics/`)

Die Lexware-Tests für Aging, Umsatz, Konzentration und USt werden übernommen. Zusätzlich gelten Invarianten:

| Fall | Prüfung | Typ |
|---|---|---|
| Summe der Monate = Gesamtumsatz | Über zufällige Belegmengen, Seed fest | Property |
| Schwelle k | Gruppe mit weniger als k Kunden liefert `suppressed: true` ohne Summe | Unit |
| Schwelle und Gegenprobe | Die unterdrückte Summe taucht in keinem anderen Feld derselben Antwort auf | Unit |
| Gutschrift | Wird vom Monat abgezogen, Anzahl steigt nicht | Unit |
| Entwurf und Vorlage | Status 100 und Typ WKR fließen in keine Summe | Unit |
| Teilzahlung | Offener Posten = Brutto minus `paidAmount`, nicht Brutto | Unit |
| USt mit Positionen | Summe je Steuersatz = Summe der Positionen, Rundung auf zwei Stellen | Unit |
| USt ohne Positionen | Wird getrennt ausgewiesen, nicht stillschweigend ausgelassen | Unit |
| Obergrenze 200 | Mehr Belege liefern Fehler mit Hinweis, kein Teilergebnis | Unit |
| Stornohinweis | Jede Auswertung enthält den Hinweis zu Stornorechnungen | Unit |

### 3.4 Redaktion (`src/redact/`)

| Fall | Prüfung | Typ |
|---|---|---|
| Pseudonym stabil | Gleicher Name bekommt im Prozess immer dieselbe Nummer | Unit |
| Adresse entfernt | Straße, Zusatz und PLZ fehlen, Ort bleibt | Unit |
| Freitext-Muster | E-Mail, IBAN, Telefon und USt-IdNr. im Text werden ersetzt | Unit, Tabelle |
| Namen im Freitext | Bekannte Schwäche, dokumentiert, Test prüft nur das Verhalten | Unit |
| Umschalter aus | `SEVDESK_REDACT=0` nimmt Pseudonyme zurück, Whitelist bleibt aktiv | Unit |

### 3.5 Tools (`src/tools.ts`)

| Fall | Prüfung | Typ |
|---|---|---|
| Tool-Liste | Genau die sieben v0.1-Tools, Namen mit Präfix `sevdesk_` | Protokoll |
| Schema | Jedes Tool hat ein Eingabeschema, Datumsfelder sind `yyyy-MM-dd` | Protokoll |
| Nur lesend | Alle Tools tragen `readOnlyHint: true`, keine Schreibpfade | Protokoll |
| Redaktion im Tool | Ausgabe enthält keinen Klarnamen aus der Fixture | Integration |
| Keine Schreib-Endpunkte | Der Client akzeptiert nur `GET` | Unit |
| Abrufmenge | Ein Tool löst höchstens die in 6.5 des Designs genannten Abrufe aus | Integration, Zähler |

### 3.6 Integration gegen Replay

Ein lokaler HTTP-Server spielt aufgezeichnete Antworten ab. Die Aufzeichnungen stammen aus Phase 0 am Testkonto und werden vor dem Commit anonymisiert.

| Szenario | Erwartung |
|---|---|
| Umsatz über zwei Monate mit Gutschrift | Summen wie im Referenzwert |
| Aging mit Teilzahlung | Restbetrag statt Brutto |
| USt mit Kleinunternehmer-Beleg | Trennung, keine Steuersumme |
| Paging über drei Seiten | Alle Belege, keine Duplikate |
| 429 mitten im Lauf | Wiederholung, Ergebnis vollständig |
| 401 beim ersten Aufruf | Fehlermeldung, Connector läuft weiter |
| Paging nicht unterstützt (V4 negativ) | Lücke wird gemeldet |

### 3.7 Live (manuell)

`scripts/live-check.mjs` liest nur, gibt Summen und Belegnummern aus, keine Namen, Adressen oder Kontaktdaten. Es prüft die offenen Punkte V3 bis V13 und schreibt das Ergebnis in eine Datei ohne Token.

## 4. Coverage-Ziele

Entscheidung des Nutzers: kritische Module 90 %, Rest 70 %.

| Modul | Ziel Zeilen | Ziel Zweige |
|---|---|---|
| `src/sevdesk/mapper.ts` (liegt in `src/analytics/index.ts`) | 90 % | 90 % |
| `src/analytics/` | 90 % | 90 % |
| `src/redact/` | 90 % | 90 % |
| `src/sevdesk/client.ts` | 70 % | 70 % |
| `src/tools.ts`, `src/server.ts`, `src/main.ts` | 70 % | 70 % |

Die Schwellen werden in `vitest.config.ts` pro Datei gesetzt, `npm test` läuft mit Coverage und bricht bei Unterschreitung. `src/main.ts` ist ausgenommen (reine Startverdrahtung). Er wird vor jedem Release per stdio-Start geprüft, siehe Abschnitt 8.

Stand: alle Module über 96 % Zeilen, Auswertungen und Mapper 100 % Zeilen und 97 % Zweige.

## 5. Lücken gegenüber dem Lexware-Connector

| Lücke | Warum sie zählt | Maßnahme |
|---|---|---|
| Redaktion arbeitet dort mit einer Sperrliste | Neue Felder der API fließen durch | Whitelist-Test (3.2) als Property-Test |
| Keine Vertragstests gegen echte Antworten | Feldnamen oder Enums können abweichen | Fixtures aus Phase 0 plus Abgleich mit der OpenAPI-Spezifikation |
| Kein Test für Ratenlimit mit Zeitverlauf | Unbekannt, welches Limit gilt | Gefälschtes `sleep`, Zeitfenster prüfen |
| Kein Test für mehrere Steuer-Modi | sevDesk hat zwei Modi | 1.0 und 2.0 getrennt testen (3.2) |

Für sevDesk fehlen alle Tests, weil noch kein Code existiert. Die Gaps beziehen sich deshalb auf die Vorlage.

## 6. Beispiel-Testfälle

| ID | Ebene | Gegeben | Wenn | Dann |
|---|---|---|---|---|
| T-01 | Client | Antwort 429 mit `Retry-After: 2` | Anfrage läuft | Wiederholung nach 2 s, danach Erfolg |
| T-02 | Client | Antwort 401 | Anfrage läuft | Meldung enthält keinen Token-Teil |
| T-03 | Mapper | Fixture mit `customerInternalNote` | Mapping | Feld fehlt im Ergebnis |
| T-04 | Mapper | Status 750 mit `paidAmount: 100` | Mapping | Typ `partiallyPaid`, Restbetrag 100 |
| T-05 | Mapper | Typ `TR` | Umsatzfilter | Beleg fehlt in Summe |
| T-06 | Analytics | Monat mit 4 Kunden | Umsatz je Monat | `suppressed: true`, keine Summe |
| T-07 | Analytics | Gutschrift 300 Euro im selben Monat | Umsatz | Monat um 300 Euro vermindert |
| T-08 | Analytics | Teilzahlung ohne `paidAmount` | Aging | Hinweis, kein Restbetrag |
| T-09 | Redaktion | Name `Anna Demo` mehrfach | Pseudonymisieren | Gleicher Platzhalter |
| T-10 | Redaktion | `SEVDESK_REDACT=0` | Mapping mit Bankdaten | Bankdaten fehlen trotzdem |
| T-11 | Tools | Alle Tool-Schemata | Protokoll-Test | Sieben Tools, alle `readOnlyHint` |
| T-12 | Integration | Replay mit drei Seiten | Rechnungsliste | Alle Belege, keine Dubletten |
| T-13 | Integration | Replay ohne Paging-Unterstützung | Rechnungsliste | Hinweis auf Lücke |
| T-14 | Live | Testkonto, Schreibrechte nicht genutzt | `live-check` | Ausgabe ohne Namen, Exit 0 |

## 7. Testdaten

- **Testkonto:** 255 Kontakte, Stand nach der Bereinigung. Die Kontakte stammen aus den CSV-Dateien in `testdata/`.
- **Belege:** Fehlen noch. Geplant sind etwa 60 Rechnungen in allen Statusstufen, Teilzahlungen, Gutschriften und Entwürfe. Das Anlegen per API braucht vorher die Referenzen für Steuerregel und Sachbearbeiter. Diese Referenzen werden im nächsten Schritt ermittelt.
- **Aufzeichnungen:** Aus den Antworten des Testkontos, anonymisiert, mit synthetischen Namen. Vor dem Commit prüft ein Skript, dass keine Adresse, E-Mail oder Steuer-ID übrig ist, die nicht aus `testdata/` stammt.
- **Keine echten Kundendaten** im Repo.

## 8. Ausführung

| Befehl | Zweck | Wann |
|---|---|---|
| `npm test` | Unit, Integration (Replay), Protokoll, Coverage mit Schwellen | jeder Build, CI |
| `npm run test:quick` | wie oben ohne Coverage | lokal |
| stdio-Smoke | `node dist/main.js` starten, per MCP-Client Tool-Liste und zwei Tools aufrufen (mit Token); ohne Token muss der Start mit Meldung und Exit 1 enden | vor jedem Release, lokal |
| `npm run typecheck` | Typprüfung | jeder Build, CI |
| `node scripts/live-check.mjs` | Live gegen Testkonto | manuell, lokal |

Live-Tests laufen nicht in CI. Das Token bleibt beim Nutzer, es wird nie als CI-Secret hinterlegt.

## 9. Offene Punkte, die Tests steuern

| Punkt (DESIGN.md, Abschnitt 9) | Test, der davon abhängt | Was jetzt gilt |
|---|---|---|
| V4 Paging auf `GET /Invoice` | T-12, T-13 | **Belegt** (offset und countAll funktionieren). T-13 entfällt, der Client setzt `limit` immer explizit |
| V3 Ratenlimit | T-01 | Backoff mit angenommenen Werten, Anpassung nach Messung |
| V6 Einheit der Datumsfilter | Datumstest in `tools.ts` | **Belegt: Sekunden.** Test prüft Unix-Sekunden mit einem Tag Spielraum |
| V7 `paidAmount` bei Altfällen | T-08 | Beide Fälle abgedeckt. Gutschriften haben nie `paidAmount` |
| V8 Storno | in v0.1 ausgeschlossen, Test prüft den Hinweis | Storno-Tests kommen mit v0.3 |

## 10. Abweichungen von der ursprünglichen Planung

- Statuswerte und Typen werden in `analytics/index.ts` zusammen mit dem Mapper getestet (Tabellen in `test/hardening.test.ts`). Kein eigenes `mapper.ts`.
- Beträge, die fehlen oder nicht numerisch sind, führen zu einem Fehler statt zu 0. Das gilt auch für ungültige Belegdaten.
- Keine Fixture-Aufzeichnungen aus dem Testkonto im Repo. Der Replay-Server liefert synthetische Belege in der Form der Live-Antworten (Summen als Zeichenketten, ISO-Datum mit Zeitzone). So bleiben Testkontodaten aus dem Repo heraus.
- Zwei Steuer-Modi (1.0 und 2.0) sind nicht getestet: Der Connector liest die Steuer ausschließlich aus den Positionen (`taxRate` je Position, Modus 2.0). Ein Konto mit Update 1.0 ist am Testkonto nicht prüfbar und bleibt eine bekannte Lücke.
