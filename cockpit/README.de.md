# Cockpit

[English version](README.md)

| Teil | Zweck |
|---|---|
| `app/` | Preact-App mit eigenem Service Worker (`app/sw/sw.ts`): Nachrichtenzentrale, Assistent, Zahlen der Apps, Mitteilungen |
| `app/sw/notification.ts` | Liest eine Push-Nachricht, baut die Mitteilung mit bis zu drei Knöpfen und ihrer Kennung (Tag; der Browser zeigt so viele, wie er kann, Chromium zwei; die Nachrichtenzentrale zeigt alle) und ruft beim Tippen auf einen Knopf `cockpit.run_action` auf, auch auf dem Sperrbildschirm; das Ergebnis ersetzt die Mitteilung unter derselben Kennung |
| `supabase/migrations/` | Schema `cockpit`: Nachrichten, Geräte, `cockpit.notify()`, Auslöser im CRM, Morgenüberblick, Postfach-Wächter; Knöpfe auf dem Sperrbildschirm über `cockpit.run_action()` |
| `supabase/functions/cockpit-push/` | Verschickt Push-Nachrichten (Verschlüsselung nach RFC 8291, Absenderkennung nach RFC 8292) an jedes Gerät; `payload.ts` baut den Inhalt mit Kennung, Berechtigungsnummer und Knöpfen |
| `deploy/cockpit-push.ts` | Dieselbe Funktion als eine Datei für den Editor im Supabase-Dashboard; erzeugt von `deploy/bundle.ts` |
| `../integration/` | Datenbanktests von Cockpit, CRM und RadarAuditor zusammen auf einem echten PostgreSQL |

## Aktionen mit einem Tippen
**Context:** Eine Nachricht in `cockpit.messages` kann Knöpfe anbieten (`actions`). | **Input:** ein Tippen auf die Mitteilung oder in der Nachrichtenzentrale. | **Output:** `cockpit.run_action(Nachricht, Berechtigungsnummer, Aktion)` führt sie aus und antwortet mit einem deutschen Satz.

| Wo | Was passiert |
|---|---|
| Mitteilung | Der Service Worker schickt die Nachrichtennummer, die Berechtigungsnummer (`action_token`) aus der Push-Nachricht und die Aktion mit dem öffentlichen Schlüssel; der Antwortsatz ersetzt die Mitteilung (gleiche Kennung). Ohne Netz steht das dort, es wird nichts wiederholt. |
| Nachrichtenzentrale | Derselbe Aufruf als angemeldeter Administrator; danach zeigt die Nachricht, welcher Knopf wann benutzt wurde und was dabei herauskam. |
| Tippen ohne Knopf | Die Mitteilung öffnet wie bisher den Link der Nachricht. |

Serveradresse und öffentlicher Schlüssel kommen beim Bauen über `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` in den Service Worker, dieselben Variablen wie für die App.

## RadarAuditor

Die Seite `/radarauditor` und die Karte in der Zentrale lesen die Tabellen von RadarAuditor mit der angemeldeten Sitzung (Schema `public`, Lesen für jeden Angemeldeten); es wird nichts kopiert.

| Zeigt | Quelle |
|---|---|
| Sammler online oder offline, letztes Lebenszeichen, Grund, wenn die Auswertung gesperrt ist | `settings.worker_heartbeat`; online, solange jünger als 2 Minuten, wie in der RadarAuditor-App |
| Laufende und fertige Audits je Kunde, Stand, Punkte | `audits`, die neuesten 40 |
| Urteil des Audit-Managers (Fertig, Unvollständig, Fehlgeschlagen) und fehlgeschlagene Messungen | `audit_events` (Art `manager` mit Bezeichnung `Audit-Manager: Ergebnis`, Art `route` mit Ergebnis `fehlgeschlagen`) |
| Kostenvoranschlag und tatsächliche Kosten je Audit, mit Prüfung des Voranschlags | `audit_estimates`, `audit_costs`, `audits.estimate_status` |
| Kosten je bezahltem Dienst im Monat gegen sein Limit | `source_usage`, Limits aus `settings.sources` (Standard 25, 10, 50 und 10 Euro) |
| Suchbegriffe je Kunde, vor Ort und bundesweit | `keywords.scope` |
| Link zur Auswertung | `https://app.radarauditor.speedofthespirit.dev/auswertung/<Audit>` |
| Start eines Audits | `queue_field_audit(Kunde, [])`, derselbe Aufruf wie in der RadarAuditor-App; zwei Tipper; gesperrt, solange ein frischer Herzschlag meldet, dass die Auswertung nicht bereit ist |

Meldungen von RadarAuditor kommen zusätzlich zu ntfy über `supabase/migrations/009_radarauditor.sql` in die Nachrichtenzentrale und aufs Handy. Die Auslöser sitzen auf den Tabellen von RadarAuditor, der Sammler braucht keine Änderung.

| Meldung (Art) | Auslöser | Rang |
|---|---|---|
| Audit gestartet (`radar-gestartet`) | erster Versuch des Sammel-Auftrags | info |
| Audit fertig (`radar-fertig`) | Urteil `gemessen`, mit Punkten | info |
| Audit unvollständig (`radar-unvollstaendig`) | Urteil `ausgesetzt` | wichtig |
| Audit fehlgeschlagen (`radar-fehlgeschlagen`) | Urteil `fehlgeschlagen` | dringend |
| Messung fehlgeschlagen (`radar-messung`) | fehlgeschlagene Messroute, einmal je Route, Grund und Stunde; Stufe 0 und 1 halten den Audit an | dringend bei Stufe 0 und 1, sonst wichtig |
| Prüfungen ohne Messwert (`radar-ohne-messwert`) | eine Sammelmeldung je Audit, Menge der Prüfungen und Tag | info |
| Sammler wieder da (`sammler-zurueck`) | Herzschlag nach mehr als 3 Minuten Pause | info |

Monatsprüfungen (eine Zeile in `crm.audit_runs`) haben schon Meldungen des CRM, deshalb entfallen für sie „gestartet“ und „fertig“. Freigabe-Anfragen von Agenten kommen als CRM-Meldung „Freigabe nötig“ (`crm.approvals`, siehe `10_Bibliothek/11_Skills/09_arbeitsweise_agenten/freigabe-vor-versand`).
## Assistent
**Context:** Seite `/assistent`, mit einem Tippen erreichbar: Mikrofon-Knopf in der oberen Leiste auf dem Handy, „Assistent“ in der Seitenleiste und eine Verknüpfung beim langen Drücken auf das installierte App-Symbol. | **Input:** eine geschriebene Anfrage oder eine Sprachaufnahme. | **Output:** eine Zeile in `crm.assistant_requests`; der Server-Arbeiter antwortet mit einer Nachricht der Art `assistent`.

| Schritt | Was passiert |
|---|---|
| Text | „Was soll ich tun?“ (höchstens 2.000 Zeichen), „Senden“ ruft `crm.ask_assistant(text, null)` auf. |
| Aufnahme | Aufs Mikrofon tippen startet, noch mal tippen beendet und sendet. `getUserMedia` einkanalig; ein AudioWorklet (`app/public/audio/capture-worklet.js`, von der eigenen Adresse der App geladen, wie es die Content Security Policy verlangt) reicht die Werte an die Seite; nach 60 Sekunden endet die Aufnahme von selbst, die restlichen Sekunden stehen daneben. Der Bildschirm bleibt so lange an (Wake Lock). |
| Umwandlung | `src/lib/audio/resample.ts` rechnet die Gerätefrequenz (meist 48 kHz) mit einem Mittelwertfilter auf 16 kHz um; `src/lib/audio/wav.ts` schreibt eine einkanalige WAV-Datei mit 16 Bit. Eine Minute sind etwa 1,9 MB, der Speicherbereich erlaubt 4 MiB. Unter einer halben Sekunde wird abgelehnt. |
| Hochladen | Die Bytes mit dem Typ `audio/wav` in den Speicherbereich `crm-assistant` unter `anfragen/<crypto.randomUUID()>.wav`, danach `crm.ask_assistant(null, Pfad)`. Scheitert das Hochladen oder die Anfrage, bleibt die Aufnahme im Speicher: „Noch mal senden“ wiederholt nur den gescheiterten Schritt, „Aufnahme verwerfen“ wirft sie weg. |
| Liste | „Letzte Anfragen“: die letzten 20 Anfragen mit Text oder „Sprachaufnahme“, Stand (Wartet, In Arbeit, Erledigt, Nicht erledigt), Ergebnis und Uhrzeit. Sie lädt neu nach dem Senden, wenn eine Nachricht der Art `assistent` ankommt und wenn die App wieder auf dem Bildschirm ist. |
| Fehler | Mikrofon gesperrt, nicht vorhanden, belegt oder nicht unterstützt, Aufnahme zu kurz und Hochladen gescheitert bekommen je einen eigenen deutschen Satz. |

`app/public/_headers` erlaubt das Mikrofon für die eigene Adresse der App (`Permissions-Policy: microphone=(self)`); vorher sperrte `microphone=()` es in jedem Browser. Mails, die der Assistent entwirft, kommen als Freigaben der Art `assistant_mail`; wie Nachfass-Mails (`follow_up`) zeigen sie „Senden“ und „Nicht senden“. Diese Texte kommen aus der Datenbank (`cockpit.on_crm_approval`, Migration 006), nicht aus der App. Die Nachrichtenarten `termin`, `assistent` und `beleg` heißen Termin, Assistent und Beleg; `audit-anfrage`, `audit-vorschlag` und `audit-termin` (Migration 007) Audit-Anfrage, Terminvorschlag und Audit-Termin. Eine solche Mitteilung mit Knöpfen führt auf `/`, die Nachrichtenzentrale; für einen Betrieb, den `crm.request_audit` aufnimmt, kommt keine Mitteilung „Neuer Kunde“ (`cockpit.on_crm_customer`).

## Prüfungen

| Teil | Befehl |
|---|---|
| App und Service Worker | `cd app && npm ci && npm run check && npm test && npm run build` |
| Edge Function | `deno check supabase/functions/cockpit-push/index.ts deploy/cockpit-push.ts` und `deno test --allow-read supabase/functions/cockpit-push deploy` |
| Eine-Datei-Fassung nach Änderung der Funktion | `deno run --allow-read --allow-write deploy/bundle.ts` |
| Auslöser der RadarAuditor-Meldungen | `powershell -File tests/sql/run.ps1` (Wegwerf-PostgreSQL in Docker, spielt alle Migrationen in der Live-Reihenfolge und `tests/sql/radarauditor_test.sql` ein) |

App veröffentlichen: `npx wrangler@4 pages deploy dist --project-name repocity-cockpit --branch main`.
