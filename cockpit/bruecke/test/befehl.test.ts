import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHidden } from "../src/befehl.ts";

const COMMAND_TEST_MS = 30_000;

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-befehl-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("runHidden", { timeout: COMMAND_TEST_MS }, () => {
  it("runs the command with its arguments in the folder and returns standard output", async () => {
    const result = await runHidden([process.execPath, "-e"], ["process.stdout.write(process.cwd() + '|' + process.argv.slice(1).join(','))", "a b", "--c"], {
      cwd: folder,
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ kind: "ok", stdout: `${folder}|a b,--c` });
  });

  it("passes text with shell characters unchanged, because no shell is used", async () => {
    const text = `"x" & echo boese | ; $(whoami) %PATH%`;
    const result = await runHidden([process.execPath, "-e", "process.stdout.write(process.argv[1])"], [text], { cwd: folder, timeoutMs: 10_000 });
    expect(result).toEqual({ kind: "ok", stdout: text });
  });

  it("names a command that does not exist", async () => {
    expect(await runHidden(["gibt-es-nicht-kommandozentrale"], [], { cwd: folder, timeoutMs: 1_000 })).toEqual({
      kind: "fehlt",
      grund: "gibt-es-nicht-kommandozentrale was not found",
    });
  });

  it("stops a command at the time limit", async () => {
    const result = await runHidden([process.execPath, "-e", "setTimeout(() => {}, 10000)"], [], { cwd: folder, timeoutMs: 300 });
    expect(result).toEqual({ kind: "fehler", grund: "no answer within 0.3 s" });
  });

  it("names output above 8 MB as too large, not as a time limit", async () => {
    const result = await runHidden([process.execPath, "-e", "process.stdout.write(\"x\".repeat(9 * 1024 * 1024))"], [], { cwd: folder, timeoutMs: 20_000 });
    expect(result).toEqual({ kind: "fehler", grund: "output larger than 8 MB" });
  });

  it("reports a command that ends with an error, without its arguments", async () => {
    const result = await runHidden([process.execPath, "-e", "process.exit(4)"], ["geheime-suche"], { cwd: folder, timeoutMs: 10_000 });
    expect(result).toEqual({ kind: "fehler", grund: "ended with code 4" });
  });

  it.runIf(process.platform === "win32")("refuses a Windows batch file, which would need a shell", async () => {
    const batch = path.join(folder, "werkzeug.cmd");
    await writeFile(batch, "@echo off\r\necho hallo\r\n");
    const result = await runHidden([batch], [], { cwd: folder, timeoutMs: 1_000 });
    expect(result.kind).toBe("fehlt");
    expect(result.kind === "fehlt" ? result.grund : "").toContain("batch file");
  });
});
