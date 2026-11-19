import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanStartLog, failurePage, withoutControlSequences } from "../src/startfehler.ts";

const CONHOST_OUTPUT = "\x1b[?25l\x1b[2J\x1b[m\x1b[H\x1b]0;C:\\Program Files\\nodejs\\node.exe\x07\x1b[?25hlistening on 127.0.0.1\r\n";

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-startfehler-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("withoutControlSequences", () => {
  it("removes the screen and title sequences of the console host and keeps the text", () => {
    expect(withoutControlSequences(CONHOST_OUTPUT)).toBe("listening on 127.0.0.1\n");
  });

  it("keeps tabs and line breaks", () => {
    expect(withoutControlSequences("a\tb\nc")).toBe("a\tb\nc");
  });
});

describe("cleanStartLog", () => {
  it("rewrites the start log without control sequences", async () => {
    const file = path.join(folder, "start.log");
    await writeFile(file, CONHOST_OUTPUT);
    await cleanStartLog(file);
    expect(await readFile(file, "utf8")).toBe("listening on 127.0.0.1\n");
  });

  it("does nothing when there is no start log", async () => {
    await expect(cleanStartLog(path.join(folder, "fehlt.log"))).resolves.toBeUndefined();
  });
});

describe("failurePage", () => {
  it.each([
    ["port_fremd", "Ein anderes Programm belegt den Port der Kommandozentrale."],
    ["beendet", "Die Brücke hat sich gleich nach dem Start wieder beendet."],
    ["keine_antwort", "Die Brücke hat nach dem Start nicht rechtzeitig geantwortet."],
    ["einstellungen", "Die Einstellungsdatei bruecke.json fehlt oder enthält einen Fehler."],
    ["unbekannt", "Beim Start ist ein unerwarteter Fehler aufgetreten."],
  ] as const)("names the cause in German for %s", (grund, ursache) => {
    const page = failurePage({ grund, meldung: "x", startprotokoll: null });
    expect(page).toContain(`<strong>Ursache:</strong> ${ursache}`);
    expect(page).toContain("<strong>Nächster Schritt:</strong>");
    expect(page).not.toContain("Startprotokoll</h2>");
  });

  it("escapes message and start log, so neither can run code in the page", () => {
    const page = failurePage({
      grund: "beendet",
      meldung: `<script>alert("x")</script> & 'y'`,
      startprotokoll: `${CONHOST_OUTPUT}<img src=x onerror=alert(1)>\n`,
    });
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
    expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page).not.toContain("<script>");
    expect(page).not.toContain("<img");
    expect(page).not.toContain("\x1b");
    expect(page).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
  });

  it("shows only the last 20 lines of the start log", () => {
    const lines = Array.from({ length: 25 }, (_, index) => `zeile-${String(index + 1)}`).join("\n");
    const page = failurePage({ grund: "beendet", meldung: "x", startprotokoll: lines });
    expect(page).toContain("zeile-6\n");
    expect(page).not.toContain("zeile-5\n");
    expect(page).toContain("zeile-25");
  });
});
