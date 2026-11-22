# Veröffentlichen auf npm

## Ablauf
1. Version in `package.json` erhöhen und per Pull Request nach `main` bringen. Typecheck, Tests und Build müssen grün sein.
2. Auf GitHub einen Release mit dem Tag `vX.Y.Z` veröffentlichen (Ziel: `main`). Der Tag muss zur Version in `package.json` passen.
3. Der Workflow `publish.yml` führt Typecheck, Tests und Build aus und veröffentlicht mit Herkunftsangabe (Provenance) auf npm.
4. Im Reiter „Actions“ prüfen, dass der Lauf grün ist, und mit `npm view <paketname> version` die Version kontrollieren.

**Das README auf npmjs.com ist das des veröffentlichten Pakets.** Änderungen am README sind dort erst nach einer neuen Version sichtbar, deshalb gehört auch eine reine README-Korrektur in eine Patch-Version.

Veröffentlichte Versionen lassen sich nicht überschreiben und nach kurzer Zeit nicht mehr zurückziehen. Vor einem Release den Paketinhalt mit `npm pack --dry-run` ansehen.

## Zugang: aktueller Stand
Der Workflow meldet sich mit dem Repository-Secret `NPM_TOKEN` an (npm Granular Access Token mit Schreibrecht).

> **Termin: Der Token läuft am 15.02.2027 ab.** Danach scheitert jeder Release mit einem Authentifizierungsfehler.

## Geplant: Umstellung auf Trusted Publishing (vor dem 15.02.2027)
Trusted Publishing ersetzt den Token durch eine Vertrauensstellung zwischen npm und diesem Workflow. Es gibt dann kein Secret mehr, das ablaufen oder gestohlen werden kann.

1. Auf npmjs.com beim Paket unter **Settings → Trusted Publisher** „GitHub Actions“ wählen und eintragen: Nutzer `muka-dev`, dieses Repository, Workflow-Datei `publish.yml`, Environment leer. Dafür wird 2FA benötigt.
2. Im Workflow die Zeile `NODE_AUTH_TOKEN` samt Secret entfernen und einen Schritt ergänzen, der npm auf Version 11.5.1 oder neuer bringt (`id-token: write` ist schon gesetzt).
3. Beim nächsten Release prüfen, dass der Lauf grün wird.
4. Danach das Secret `NPM_TOKEN` löschen, den Token auf npmjs.com widerrufen und optional in den Paketeinstellungen „Require two-factor authentication and disallow tokens“ aktivieren.

Bezeichnungen auf npmjs.com können abweichen. Maßgeblich ist die aktuelle npm-Dokumentation zu Trusted Publishing.
