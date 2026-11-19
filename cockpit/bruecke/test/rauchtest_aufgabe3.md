---
Art: Pruefbericht
Zweck: Rauchtest von Aufgabe 3 (Sitzungen) mit echtem Claude Code über das Pseudo-Terminal der Brücke, belegt mit Rohausgaben
Stand: durchgeführt am 2026-11-18, Befund 1 als überholt gekennzeichnet am 2026-11-18
Version: 2
Aufruf: 
---

# Rauchtest Aufgabe 3 – echtes `claude` im Pseudo-Terminal

## Aufbau

- Rechner: Daniels PC, Windows 10 Pro 19045, Node 24.13.0, Claude Code 2.1.322.
- Bibliothek: `@lydell/node-pty` 1.2.0-beta.18 (ConPTY von Windows, ohne `useConptyDll`).
- Treiber: ein Wegwerf-Skript im Scratch-Ordner der Sitzung, das ausschließlich `Sessions` aus `src/sitzungen.ts` benutzt (`open`, `create`, `connect`, `input`, `resize`, `history`, `end`, `close`). Kein Auftrag an Claude abgeschickt.
- Einstellungen des Laufs: Vault `C:/AI_Enterprise_Zentrale` als einziger erlaubter Ordner, `claudeBefehl` `["claude.exe"]`, Datenordner im Scratch-Ordner.
- Der Treiber lief aus einer Claude-Code-Sitzung heraus; dafür wurden `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` und `CLAUDE_CODE_SSE_PORT` vor dem Start entfernt.

## Ergebnis

| Prüfpunkt | Ergebnis | Beleg (Rohausgabe, gekürzt) |
|---|---|---|
| Start im Vault, Ausgabe kommt an | bestanden | Kopf `Claude Code v2.1.322`, `Opus 5.5 · Claude Ultra`, `C:\AI_Enterprise_Zentrale`, Eingabezeile `❯` (6252 Zeichen in 15 s) |
| Farben (ANSI-Folgen) | bestanden | 133 SGR-Folgen im Start, davon 62 Echtfarben, etwa `\x1b[38;2;215;119;87m` (Logo) und `\x1b[38;2;153;153;153m` |
| Umlaute äöüß | bestanden | Eingabe `"äöüß"` → Ausgabe `'\x1b[?2004h\x0f\x08äöüß\x1b[K…'` |
| Pfeiltasten | bestanden | `abc`, zweimal `\x1b[D`, `X` → `'abc\x1b[25;8H…Xbc\x1b[25;9H'`: Schreibmarke zwei Stellen nach links, `X` eingefügt, Zeile `äöüßaXbc` |
| Löschen | bestanden | acht Rückschritte an der Schreibmarke löschen die sechs Zeichen links davon; `bc` rechts bleibt stehen (`'\x1b[25;3Hbc\x1b[K'`) |
| Einfügen von 5.000 Zeichen | bestanden | Claude schaltet Klammer-Einfügen ein (`\x1b[?2004h`); 5.000 Zeichen zwischen `\x1b[200~` und `\x1b[201~` → `[Pasted text #1]bc`, nicht abgeschickt |
| Größenänderung 120×30 → 80×24 → 140×40 | bestanden | jeweils `{"kind":"ok"}`; Claude zeichnet neu und bricht bei 80 Spalten um (`…dev-only vit` / `est chain…`), bei 140 Spalten breiter |
| Eingabezeile leeren | bestanden | Strg+U → `Ctrl+Y to paste deleted text` |
| Kein sichtbares Fenster | bestanden | Prozessbaum während des Laufs (node → conhost, claude.exe, cmd, uvx, node …): `MainWindowHandle` überall `0` |
| Sauberes Beenden mit `/exit` | bestanden (zweiter Lauf) | Strg+U, `/exit`, Enter → Prozess endet nach 3,4 s mit `exitCode 0`; die Brücke meldet `geaendert` und zeigt `"prozess":"beendet","exitCode":0` |

## Abweichungen und Befunde

1. **Überholt (18.11.2026):** Die Brücke sucht den Befehl inzwischen selbst mit `findCommand` (`src/kindprozess.ts`) und den Endungen aus `PATHEXT`; `["claude"]` reicht damit auch unter Windows (belegt durch `test/kindprozess.test.ts`, mit echtem `claude` nicht erneut geprüft). Ursprünglicher Befund: **`claude` ohne `.exe` startet unter Windows nicht.** Erster Lauf mit `claudeBefehl: ["claude"]`: `Error: File not found:` aus `windowsPtyAgent.js:50`. ConPTY sucht den Befehl ohne die Endungen aus `PATHEXT`. Unter Windows muss in `bruecke.json` `["claude.exe"]` (oder der volle Pfad) stehen; unter Linux bleibt `["claude"]`.
2. **Erster Lauf endete nicht mit `/exit`.** Der Treiber löschte mit Rückschritten nur links der Schreibmarke, `bc` blieb stehen; Enter auf `/exitbc` ergab lokal `Unknown command: /exitbc. Did you mean /exit?` (nichts ging an das Modell). Die Sitzung wurde danach mit `end()` beendet (`{"kind":"ok"}`). Der zweite Lauf hat `/exit` sauber geprüft.
3. **Hinweis von Claude im ersten Lauf:** `⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker`. Die Variable stammte aus der Claude-Sitzung, die den Treiber startete. Erbt die Brücke sie je, speichert Claude kein Gespräch, und `--resume` findet nichts. Im zweiten Lauf war sie entfernt.
4. Bildschirmfotos waren nicht möglich; die Belege sind Rohausgaben.
