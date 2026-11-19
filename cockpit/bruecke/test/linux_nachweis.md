---
Art: Pruefbericht
Zweck: Nachweis, dass Prüfbefehle und Tests der Brücke unter Linux laufen (Docker), Stand nach dem Umbau der Sitzungen auf den Chat mit claude -p und stream-json (Bauteil 1c, C1 bis C3)
Stand: durchgeführt am 2026-11-19
Version: 5
Aufruf: 
---

# Linux-Nachweis der Brücke

## Aufbau

- Abbild `node:24-bookworm` (Node v24.22.3, x86_64), Benutzer `node`, gestartet versteckt über `Start-Process -WindowStyle Hidden` mit Protokolldateien.
- Quelle: frische Kopie von `bruecke/` ohne `node_modules` und ohne die lokale `bruecke.json` in einem neuen Ordner (`linux8`), nur lesend eingehängt nach `/quelle`, im Behälter nach `/home/node/bruecke` kopiert.
- Ablauf: `npm ci`, `npm run check`, `npm test -- --reporter=verbose`. Der frühere Pseudo-Terminal-Lauf entfällt, weil die Brücke kein Pseudo-Terminal mehr nutzt (`@lydell/node-pty` ist entfernt).

## Ergebnis

| Schritt | Ergebnis |
|---|---|
| `npm ci` | erfolgreich |
| `npm run check` | Rückgabewert 0 |
| `npm test` | 26 Testdateien bestanden; 814 Tests bestanden, 5 übersprungen (nur unter Windows sinnvoll), 0 rot; Rückgabewert 0 |

Übersprungen unter Linux:
- `menue.test.ts` › qmd as a Windows batch file › names the batch file and the command to use instead
- `kindprozess.test.ts` › compares names and folders without case on Windows
- `kindprozess.test.ts` › prefers the program over a file without extension and accepts a given extension
- `private_datei.test.ts` › reports nothing on Windows, where modes do not apply
- `befehl.test.ts` › refuses a Windows batch file, which would need a shell

Neu gegenüber Version 4: `chat.test.ts` (Übersetzung der stream-json-Ereignisse in Chat-Einträge, Antworten auf Fragekarten), `chatprotokoll.test.ts` (Chat-Protokoll je Sitzung, nur für den Besitzer lesbar, Verdichten bei Übergröße), `zeilen.test.ts` (Zeilenleser mit Obergrenze); `sitzungen.test.ts` mit Chat-Prozess, Fragekarte, Plankarte, Abbrechen und Chat-Protokoll über einen Neustart; `server.test.ts` mit den neuen Nachrichten. Entfallen ist `sitzungen_spione.test.ts` (Pseudo-Terminal).

## Vergleich mit Windows

Windows 10 (Daniels PC), dreimal `npm test` auf demselben Stand: je 26 Testdateien, 799 bestanden, 20 übersprungen, 0 rot. Die Differenz der übersprungenen Tests sind Prüfungen, die nur unter POSIX gelten (Dateirechte, SIGTERM, gesperrte Ordner).

## Belege

Rohprotokolle im Scratchpad der Sitzung: `linux8/linux.out.log` (852 Zeilen) und `linux8/linux.err.log`.

## Version 4 (Vorstand)

Lauf nach Wegfall von Passwort und Anmeldung, Ordner `linux7`: 24 Testdateien, 746 bestanden, 5 übersprungen, 0 rot.

## Version 3 (Vorstand)

Lauf nach der Korrekturrunde zu Aufgabe 9 und 10, Ordner `linux6`: 29 Testdateien, 878 bestanden, 5 übersprungen, 0 rot.

## Version 2 (Vorstand)

Lauf nach Aufgabe 9 (Brückenteil), Aufgabe 10 und der Behebung des Wackeltests der Meldeskripte, Ordner `linux3`: 29 Testdateien, 843 bestanden, 4 übersprungen, 0 rot.

## Version 1 (Vorstand)

Lauf nach den Korrekturen aus der Prüfung von Aufgabe 7: 25 Testdateien, 763 bestanden, 3 übersprungen, 0 rot. Behobene Ursachen des Laufs davor: Testordner `konfig` mit 0o700 statt Standardrechten; ein Browser, der während einer Datei geht, gilt nicht mehr als Fehler.
