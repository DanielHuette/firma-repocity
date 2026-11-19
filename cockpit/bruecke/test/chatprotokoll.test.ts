import { appendFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Eintrag } from "../src/chat.ts";
import { ChatProtokoll, chatDatei, chatLaden } from "../src/chatprotokoll.ts";

let ordner: string;
let datei: string;

beforeEach(async () => {
  ordner = await mkdtemp(path.join(tmpdir(), "bruecke-chat-"));
  datei = chatDatei(ordner, "11111111-2222-4333-8444-555555555555");
});

afterEach(async () => {
  await rm(ordner, { recursive: true, force: true });
});

function eintrag(id: string, text = "x"): Eintrag {
  return { id, art: "claude", zeit: 1, text };
}

describe("chat log", () => {
  it("lies in the chat folder of the data folder, named after the session", () => {
    expect(datei).toBe(path.join(ordner, "chat", "11111111-2222-4333-8444-555555555555.ndjson"));
  });

  it("gives nothing when there is no log yet", async () => {
    expect(await chatLaden(datei)).toEqual({ eintraege: [], kaputt: 0 });
  });

  it("keeps the order of the first appearance and the last state of each entry", async () => {
    const alle = [eintrag("a", "neu"), eintrag("b")];
    const protokoll = new ChatProtokoll(datei);
    await protokoll.schreiben([eintrag("a", "")], () => alle);
    await protokoll.schreiben([eintrag("b"), eintrag("a", "neu")], () => alle);
    expect((await chatLaden(datei)).eintraege).toEqual([eintrag("a", "neu"), eintrag("b")]);
  });

  it.skipIf(process.platform === "win32")("is readable by the owner only", async () => {
    await new ChatProtokoll(datei).schreiben([eintrag("a")], () => []);
    expect((await stat(datei)).mode & 0o077).toBe(0);
    expect((await stat(path.dirname(datei))).mode & 0o077).toBe(0);
  });

  it("counts and skips a broken line, such as one cut by a crash", async () => {
    await new ChatProtokoll(datei).schreiben([eintrag("a")], () => []);
    await appendFile(datei, '{"id":"b","art":"claude"\n{"id":"c","art":"unbekannt","zeit":1}\n');
    expect(await chatLaden(datei)).toEqual({ eintraege: [eintrag("a")], kaputt: 2 });
  });

  it("rewrites itself with the newest entries up to half the limit once it grows past the limit", async () => {
    const alle = Array.from({ length: 20 }, (_, stelle) => eintrag(`e${String(stelle).padStart(2, "0")}`, "y".repeat(50)));
    const zeile = Buffer.byteLength(`${JSON.stringify(alle[0])}\n`);
    const protokoll = new ChatProtokoll(datei, zeile * 10);
    await protokoll.schreiben(alle.slice(0, 10), () => alle.slice(0, 10));
    expect((await chatLaden(datei)).eintraege).toHaveLength(10);
    await protokoll.schreiben(alle.slice(10, 11), () => alle.slice(0, 11));
    expect((await chatLaden(datei)).eintraege.map((wert) => wert.id)).toEqual(["e06", "e07", "e08", "e09", "e10"]);
  });

  it("removes the log of an ended session", async () => {
    const protokoll = new ChatProtokoll(datei);
    await protokoll.schreiben([eintrag("a")], () => []);
    await protokoll.loeschen();
    await expect(readFile(datei)).rejects.toThrow();
  });
});
