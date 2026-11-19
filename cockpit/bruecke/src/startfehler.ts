import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasErrorCode } from "./private_datei.ts";

export const FAILURE_PAGE_FILE = "start_fehler.html";
const SHOWN_LOG_LINES = 20;
const ESCAPE = String.fromCharCode(0x1b);
const BELL = String.fromCharCode(0x07);
const CONTROL_SEQUENCES = new RegExp(
  [
    String.raw`${ESCAPE}\][^${BELL}${ESCAPE}]*(?:${BELL}|${ESCAPE}\\)`,
    String.raw`${ESCAPE}\[[0-?]*[ -/]*[@-~]`,
    String.raw`${ESCAPE}[@-_]`,
    String.raw`[\u0000-\u0008\u000b-\u001f\u007f]`,
  ].join("|"),
  "g",
);
const LINE_BREAK = /\r?\n/;

export type StartGrund = "port_fremd" | "beendet" | "keine_antwort" | "einstellungen" | "unbekannt";

export interface StartFailure {
  readonly grund: StartGrund;
  readonly meldung: string;
  readonly startprotokoll: string | null;
}

const EXPLANATIONS: Readonly<Record<StartGrund, { ursache: string; schritt: string }>> = {
  port_fremd: {
    ursache: "Ein anderes Programm belegt den Port der Kommandozentrale.",
    schritt: "Das andere Programm beenden oder in bruecke.json einen anderen Wert für portOberflaeche eintragen, dann die Verknüpfung erneut öffnen.",
  },
  beendet: {
    ursache: "Die Brücke hat sich gleich nach dem Start wieder beendet.",
    schritt: "Den Grund nennen die Zeilen aus dem Startprotokoll unten. Ihn beheben und die Verknüpfung erneut öffnen.",
  },
  keine_antwort: {
    ursache: "Die Brücke hat nach dem Start nicht rechtzeitig geantwortet.",
    schritt: "Die Zeilen aus dem Startprotokoll unten ansehen und die Verknüpfung erneut öffnen.",
  },
  einstellungen: {
    ursache: "Die Einstellungsdatei bruecke.json fehlt oder enthält einen Fehler.",
    schritt: "bruecke.json im Ordner bruecke prüfen (Vorlage: bruecke.beispiel.json) und die Verknüpfung erneut öffnen.",
  },
  unbekannt: {
    ursache: "Beim Start ist ein unerwarteter Fehler aufgetreten.",
    schritt: "Die Meldung unten an Claude weitergeben.",
  },
};

export function withoutControlSequences(text: string): string {
  return text.replace(CONTROL_SEQUENCES, "");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function lastLines(text: string): string {
  const lines = withoutControlSequences(text).split(LINE_BREAK).filter((line) => line.trim() !== "");
  return lines.slice(-SHOWN_LOG_LINES).join("\n");
}

export function failurePage(failure: StartFailure): string {
  const { ursache, schritt } = EXPLANATIONS[failure.grund];
  const log =
    failure.startprotokoll === null || failure.startprotokoll.trim() === ""
      ? ""
      : `<h2>Letzte Zeilen aus dem Startprotokoll</h2>\n<pre>${escapeHtml(lastLines(failure.startprotokoll))}</pre>\n`;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Kommandozentrale startet nicht</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5}pre{white-space:pre-wrap;background:#f3f3f3;padding:1rem;border-radius:8px}</style>
</head>
<body>
<h1>Kommandozentrale startet nicht</h1>
<p><strong>Ursache:</strong> ${escapeHtml(ursache)}</p>
<p><strong>Nächster Schritt:</strong> ${escapeHtml(schritt)}</p>
<h2>Meldung</h2>
<pre>${escapeHtml(withoutControlSequences(failure.meldung))}</pre>
${log}</body>
</html>
`;
}

export async function readStartLog(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function cleanStartLog(file: string): Promise<void> {
  const content = await readStartLog(file);
  if (content === null) return;
  const cleaned = withoutControlSequences(content);
  if (cleaned !== content) await writeFile(file, cleaned);
}

export function failurePagePath(folder: string): string {
  return path.join(folder, FAILURE_PAGE_FILE);
}
