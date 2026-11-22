# Fehlerbilder und Lösungen

## Die Tools `sevdesk_*` erscheinen nicht

- Der Eintrag muss `npx` mit den Argumenten `-y` und `claude-sevdesk-connector` nennen. Beim ersten Start lädt `npx` das Paket, das braucht Netz und etwas Zeit.
- Bei einer Installation aus dem Quellcode: Pfad zu `dist/main.js` prüfen, vorher muss `npm run build` gelaufen sein.
- Node.js 22 oder neuer ist nötig (`node -v`).
- Claude Desktop nach jeder Änderung der Konfiguration neu starten.
- Beim Start mit fehlendem Token bricht der Connector ab: `sevDesk API token is missing. Set SEVDESK_TOKEN.`

## `sevDesk API error 401`

Der Token fehlt, ist falsch oder wurde zurückgesetzt. Neu aus sevDesk holen und in `SEVDESK_TOKEN` eintragen.
Hinter einem Proxy: Node-`fetch` nutzt `HTTPS_PROXY` nicht von selbst. `NODE_USE_ENV_PROXY=1` setzen (Node ab 22.21).

## `sevDesk API error 429`

Das Ratenlimit ist erreicht. Der Connector wartet und wiederholt bis zu dreimal. Hilft das nicht, den Zeitraum verkleinern oder später erneut fragen.

## Kontakte fehlen

Personen erscheinen in `GET /Contact` nur mit `depth=20`. Der Connector setzt das selbst. Bleibt die Liste trotzdem leer, gibt es keine passenden Kontakte, oder der Suchbegriff passt nicht. Die Suche prüft Name, Vor- und Nachname und Kundennummer.

## Auswertung zeigt `suppressed: true` oder `null`

Eine Gruppe hat weniger als fünf verschiedene Kunden. Das ist gewollt. Mit `SEVDESK_MIN_GROUP=1` lässt sich die Schwelle abschalten (nur mit Testdaten sinnvoll).

## Umsatz oder USt stimmt nicht mit sevDesk überein

- Stornorechnungen (SR) sind nicht berücksichtigt, das steht im Ergebnis.
- Entwürfe, Mahnungen, Teil- und Abschlagsrechnungen zählen nicht zum Umsatz.
- Belege mit unbekanntem Status (zum Beispiel 50, 300, 500) stehen in `unknownStatusCount`.
- Der Zeitraum richtet sich nach dem Belegdatum.

## Offene Posten wirken zu alt oder zu jung

Fehlt an der Rechnung das Zahlungsziel, gelten 14 Tage. Die Auswertung nennt die Anzahl in `notes`. Fehlt `paidAmount`, zählt der volle Betrag als offen.

## USt-Übersicht dauert lange oder bricht ab

Je Rechnung wird ein Aufruf gemacht, nacheinander. Rund 40 Rechnungen brauchen etwa 10 Sekunden. Mehr als 200 Rechnungen je Aufruf werden abgelehnt, dann den Zeitraum verkleinern.

## `Too many invoices for one VAT summary`

Zeitraum verkleinern, zum Beispiel auf ein Quartal.
