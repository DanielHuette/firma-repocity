import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult, RunOptions } from "../src/befehl.ts";
import { Menu } from "../src/menue.ts";
import type { MenuOptions } from "../src/menue.ts";

let root: string;
let vault: string;
let now: number;
let servers: Server[];

async function write(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-menue-")));
  vault = path.join(root, "vault");
  now = 1_000_000;
  servers = [];
  await write(path.join(vault, "00_System", "notiz.md"), "erste Zeile\nHier steht die Kommandozentrale drin\nletzte Zeile\n");
});

afterEach(async () => {
  for (const server of servers) server.close();
  await rm(root, { recursive: true, force: true });
});

interface Call {
  args: readonly string[];
  options: RunOptions;
}

function options(changes: Partial<MenuOptions> = {}): MenuOptions {
  return {
    vault,
    erlaubteOrdner: [vault],
    qmdBefehl: ["qmd"],
    claudeMem: "http://127.0.0.1:1",
    now: () => now,
    run: () => Promise.resolve({ kind: "fehlt", grund: "qmd was not found" }),
    ...changes,
  };
}

function runner(answers: Record<string, CommandResult>, calls: Call[]): MenuOptions["run"] {
  return (_command, args, runOptions) => {
    calls.push({ args, options: runOptions });
    return Promise.resolve(answers[args[0] ?? ""] ?? { kind: "fehler", grund: "unexpected" });
  };
}

async function memoryServer(answer: (request: IncomingMessage) => { status: number; body: string }): Promise<string> {
  const server = createServer((request, response) => {
    const { status, body } = answer(request);
    response.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

describe("search in the vault with qmd", () => {
  let memory: string;

  beforeEach(async () => {
    memory = await memoryServer(() => ({ status: 200, body: JSON.stringify({ observations: [] }) }));
  });

  const FOUND = JSON.stringify([
    {
      score: 0.91,
      file: "VAULT/10_Bibliothek/notiz.md",
      line: 21,
      title: "Notiz",
      snippet: "1: @@ -20,4 @@ (19 before, 7 after)\n2: \n3: ## Stand 18.11.2026: Kommandozentrale\n4: Entschieden von Daniel",
    },
    { score: 0.5, file: "/anderswo/datei.md", line: 3, title: "Fremd", snippet: "1: x" },
  ]);

  it("updates the index first, then searches with the text after --, and reads the JSON answer", async () => {
    const calls: Call[] = [];
    const answers = { update: { kind: "ok", stdout: "" }, search: { kind: "ok", stdout: FOUND.replace("VAULT", vault.replaceAll("\\", "\\\\")) } } as const;
    const result = await new Menu(options({ run: runner(answers, calls), claudeMem: memory })).search("--index fremd");
    expect(calls.map((call) => call.args)).toEqual([
      ["update"],
      ["search", "--line-numbers", "--full-path", "--format", "json", "-n", "20", "--", "--index fremd"],
    ]);
    expect(calls.every((call) => call.options.cwd === vault && call.options.timeoutMs === 20_000)).toBe(true);
    expect(result.vault).toEqual([
      { pfad: "10_Bibliothek/notiz.md", zeile: 21, auszug: "## Stand 18.11.2026: Kommandozentrale Entschieden von Daniel" },
      { pfad: path.resolve("/anderswo/datei.md"), zeile: 3, auszug: "x" },
    ]);
    expect(result.fehler).toBeUndefined();
  });

  it("still searches when the update fails and says so", async () => {
    const answers = { update: { kind: "fehler", grund: "no answer within 20 s" }, search: { kind: "ok", stdout: "[]" } } as const;
    const result = await new Menu(options({ run: runner(answers, []), claudeMem: memory })).search("x");
    expect(result.fehler).toBe("Vault-Index nicht aktualisiert (no answer within 20 s)");
  });

  it.each([
    ["qmd is missing", { kind: "fehlt", grund: "qmd was not found" }, "qmd nicht verfügbar (qmd was not found); einfache Suche"],
    ["qmd fails", { kind: "fehler", grund: "ended with code 1" }, "qmd nicht verfügbar (ended with code 1); einfache Suche"],
    ["qmd answers no JSON", { kind: "ok", stdout: "No results found." }, "Antwort von qmd nicht lesbar; einfache Suche"],
  ] as const)("falls back to its own search in the Markdown files when %s", async (_case, search, note) => {
    const answers: Record<string, CommandResult> = { update: { kind: "ok", stdout: "" }, search };
    const result = await new Menu(options({ run: runner(answers, []), claudeMem: memory })).search("kommandozentrale");
    expect(result.vault).toEqual([{ pfad: "00_System/notiz.md", zeile: 2, auszug: "Hier steht die Kommandozentrale drin" }]);
    const [qmdNote, ...memoryNotes] = (result.fehler ?? "").split("; claude-mem");
    expect(qmdNote).toBe(note);
    expect(memoryNotes.length).toBeLessThanOrEqual(1);
  });

  it("returns at most 50 hits from its own search", async () => {
    await write(path.join(vault, "viel.md"), Array.from({ length: 60 }, (_, index) => `Treffer ${String(index)}`).join("\n"));
    expect((await new Menu(options({ claudeMem: memory })).search("treffer")).vault).toHaveLength(50);
  });
});

describe("search in claude-mem", () => {
  it("asks /api/search for observations as JSON and lists id, title and date", async () => {
    let asked = "";
    const address = await memoryServer((request) => {
      asked = request.url ?? "";
      const observations = [
        { id: 7819, title: "Entscheidung A", created_at: "2026-11-18T12:55:46.685Z", narrative: "lang" },
        { id: 7820, title: null, created_at: "2026-11-18T13:00:00.000Z" },
        { id: "obs-3", title: "Text-Kennung", created_at: "2026-11-18T14:00:00.000Z" },
        { id: null, title: "ohne Kennung", created_at: "2026-11-18T15:00:00.000Z" },
      ];
      return { status: 200, body: JSON.stringify({ observations, sessions: [], prompts: [], totalResults: 3, query: "q" }) };
    });
    const result = await new Menu(options({ claudeMem: address })).search("Kommando zentrale");
    expect(asked).toBe("/api/search?query=Kommando+zentrale&format=json&type=observations&limit=20");
    expect(result.erinnerung).toEqual([
      { id: 7819, titel: "Entscheidung A", datum: "2026-11-18T12:55:46.685Z" },
      { id: 7820, titel: "(ohne Titel)", datum: "2026-11-18T13:00:00.000Z" },
      { id: "obs-3", titel: "Text-Kennung", datum: "2026-11-18T14:00:00.000Z" },
    ]);
  });

  it("gives no memories and names the reason when claude-mem cannot be reached", async () => {
    const closed = await memoryServer(() => ({ status: 200, body: "{}" }));
    for (const server of servers) await new Promise<void>((resolve) => server.close(() => {
      resolve();
    }));
    const result = await new Menu(options({ claudeMem: closed })).search("x");
    expect(result.erinnerung).toEqual([]);
    expect(result.fehler).toContain("claude-mem nicht erreichbar (ECONNREFUSED)");
  });

  it("gives no memories and a note when claude-mem answers with an error", async () => {
    const address = await memoryServer(() => ({ status: 500, body: "{}" }));
    const result = await new Menu(options({ claudeMem: address })).search("x");
    expect(result.erinnerung).toEqual([]);
    expect(result.fehler).toContain("claude-mem antwortet mit 500");
  });
});

describe("folders for a new session", () => {
  it("lists allowed folders and subfolders two levels deep, sorted, without hidden folders, node_modules and .git", async () => {
    const other = path.join(root, "anderer");
    for (const folder of [path.join(other, "a", "b", "c"), path.join(other, ".git", "x"), path.join(other, "node_modules", "y"), path.join(other, ".z")]) {
      await mkdir(folder, { recursive: true });
    }
    const folders = await new Menu(options({ erlaubteOrdner: [other] })).folders();
    expect(folders).toEqual([
      { pfad: other, name: "anderer" },
      { pfad: path.join(other, "a"), name: "a" },
      { pfad: path.join(other, "a", "b"), name: "b" },
    ]);
  });

  it("lists at most 500 folders", async () => {
    const many = path.join(root, "viele");
    for (let index = 0; index < 600; index += 1) await mkdir(path.join(many, `ordner-${String(index).padStart(3, "0")}`), { recursive: true });
    expect(await new Menu(options({ erlaubteOrdner: [many] })).folders()).toHaveLength(500);
  });

  it("skips an allowed folder that does not exist", async () => {
    expect(await new Menu(options({ erlaubteOrdner: [path.join(root, "fehlt")] })).folders()).toEqual([]);
  });
});

describe("limits of the search", () => {
  let memory: string;

  beforeEach(async () => {
    memory = await memoryServer(() => ({ status: 200, body: JSON.stringify({ observations: [] }) }));
  });

  it("does not start a search that was replaced before its turn", async () => {
    const calls: Call[] = [];
    const replaced = new AbortController();
    replaced.abort();
    const answers: Record<string, CommandResult> = { update: { kind: "ok", stdout: "" }, search: { kind: "ok", stdout: "[]" } };
    await expect(new Menu(options({ run: runner(answers, calls), claudeMem: memory })).search("x", replaced.signal)).rejects.toThrow(/abort/i);
    expect(calls).toEqual([]);
  });

  it("refuses the vault part of a search when four vault searches already wait", async () => {
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run: MenuOptions["run"] = async () => {
      await blocked;
      return { kind: "ok", stdout: "[]" };
    };
    const menu = new Menu(options({ run, claudeMem: memory }));
    const running = Array.from({ length: 5 }, (_, index) => menu.search(`suche-${String(index)}`));
    const sixth = await menu.search("zu viel");
    expect(sixth).toMatchObject({ vault: [], fehler: "Vault-Suche ausgelastet, bitte gleich noch einmal" });
    release();
    await Promise.all(running);
  });

  it("stops its own search at its time limit and says so", async () => {
    const menu = new Menu(options({ claudeMem: memory, limits: { ownSearchMs: 0 } }));
    expect((await menu.search("kommandozentrale")).fehler).toContain("einfache Suche nach 0 s abgebrochen");
  });

  it("reads at most the given number of files in its own search", async () => {
    const menu = new Menu(options({ claudeMem: memory, limits: { ownSearchFiles: 0 } }));
    const result = await menu.search("kommandozentrale");
    expect(result.vault).toEqual([]);
    expect(result.fehler).toContain("einfache Suche nach 0 Dateien abgebrochen");
  });
});

describe("answers of claude-mem that cannot be used", () => {
  const FOUND = JSON.stringify([{ file: "VAULT/a.md", line: 1, snippet: "1: Treffer" }]);

  function withVault(changes: Partial<MenuOptions>): Menu {
    const answers: Record<string, CommandResult> = {
      update: { kind: "ok", stdout: "" },
      search: { kind: "ok", stdout: FOUND.replace("VAULT", vault.replaceAll("\\", "\\\\")) },
    };
    return new Menu(options({ run: runner(answers, []), ...changes }));
  }

  it("does not follow a redirect", async () => {
    const address = await memoryServer(() => ({ status: 302, body: "" }));
    const result = await withVault({ claudeMem: address }).search("x");
    expect(result.vault).toHaveLength(1);
    expect(result.fehler).toContain("claude-mem");
  });

  it("refuses an answer above 1 MB and keeps the vault hits", async () => {
    const address = await memoryServer(() => ({ status: 200, body: JSON.stringify({ observations: [], fill: "x".repeat(1024 * 1024) }) }));
    const result = await withVault({ claudeMem: address }).search("x");
    expect(result.vault).toHaveLength(1);
    expect(result.erinnerung).toEqual([]);
    expect(result.fehler).toContain("Antwort von claude-mem zu groß");
  });

  it("names a body that does not arrive in time and keeps the vault hits", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{\"observations\":[");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const result = await withVault({ claudeMem: address, limits: { memoryTimeoutMs: 300 } }).search("x");
    server.closeAllConnections();
    expect(result.vault).toHaveLength(1);
    expect(result.fehler).toContain("Antwort von claude-mem nicht lesbar");
  });
});

describe("qmd as a Windows batch file", () => {
  it.runIf(process.platform === "win32")("names the batch file and the command to use instead", async () => {
    const npm = path.join(root, "npm");
    await write(path.join(npm, "qmd.cmd"), "@echo off\r\n");
    const problem = await new Menu(options({ qmdBefehl: [path.join(npm, "qmd.cmd")] })).qmdProblem();
    expect(problem).toContain("qmd.cmd");
    expect(problem).toContain(JSON.stringify(["node", path.join(npm, "node_modules", "@tobilu", "qmd", "bin", "qmd")]));
  });

  it("names nothing when qmd can be started directly", async () => {
    expect(await new Menu(options({ qmdBefehl: [process.execPath] })).qmdProblem()).toBeUndefined();
  });
});
