import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keepOnePrevious, LOG_FILE, LOG_LIMIT_BYTES, openLog } from "../src/protokoll.ts";

const AT = new Date(Date.UTC(2026, 10, 18, 12, 30, 5));

let folder: string;
let dataFolder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-protokoll-"));
  dataFolder = path.join(folder, "daten");
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function logged(): Promise<string> {
  return readFile(path.join(dataFolder, LOG_FILE), "utf8");
}

describe("openLog", () => {
  it("creates the data folder and appends lines with time and level", async () => {
    const log = await openLog(dataFolder, () => AT);
    log.info("bridge started");
    await log.close();
    const again = await openLog(dataFolder, () => AT);
    again.info("second start");
    await again.close();
    expect(await logged()).toBe("2026-11-18T12:30:05.000Z INFO bridge started\n2026-11-18T12:30:05.000Z INFO second start\n");
  });

  it("writes an error with name, message, stack and cause, each further line indented", async () => {
    const log = await openLog(dataFolder, () => AT);
    log.error("login failed", new Error("outer", { cause: new TypeError("inner") }));
    await log.close();
    const lines = (await logged()).split("\n");
    expect(lines[0]).toBe("2026-11-18T12:30:05.000Z ERROR login failed: Error: outer");
    expect(lines.slice(1, -1).every((line) => line.startsWith("    "))).toBe(true);
    expect(lines).toContain("    caused by: TypeError: inner");
  });

  it("writes a thrown value that is no error", async () => {
    const log = await openLog(dataFolder, () => AT);
    log.error("odd failure", { kind: "seltsam" });
    log.error("odd failure", "text");
    await log.close();
    expect(await logged()).toBe(
      "2026-11-18T12:30:05.000Z ERROR odd failure: { kind: 'seltsam' }\n2026-11-18T12:30:05.000Z ERROR odd failure: text\n",
    );
  });

  it("escapes control characters, so a message cannot fake a line", async () => {
    const log = await openLog(dataFolder, () => AT);
    log.info("folder /a\n2026-01-01T00:00:00.000Z INFO fake\u001b[31m");
    await log.close();
    expect(await logged()).toBe("2026-11-18T12:30:05.000Z INFO folder /a\\u000a2026-01-01T00:00:00.000Z INFO fake\\u001b[31m\n");
  });

  it.skipIf(process.platform === "win32")("keeps the log readable only by its owner", async () => {
    const log = await openLog(dataFolder, () => AT);
    log.info("x");
    await log.close();
    expect((await stat(path.join(dataFolder, LOG_FILE))).mode & 0o777).toBe(0o600);
  });
});

describe("size limit", () => {
  it("moves a full log to one predecessor file and starts a new one, keeping only one predecessor", async () => {
    const log = await openLog(dataFolder, () => AT, { maxBytes: 120 });
    for (let line = 1; line <= 6; line += 1) log.info(`line ${String(line)} ${"x".repeat(30)}`);
    await log.close();
    const current = await logged();
    const previous = await readFile(path.join(dataFolder, `${LOG_FILE}.1`), "utf8");
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(120);
    expect(current).toContain("line 6");
    expect(previous).toContain("line 5");
    expect(previous).not.toContain("line 1 ");
    expect(await readdir(dataFolder)).toEqual([LOG_FILE, `${LOG_FILE}.1`]);
  });

  it("keeps writing to the full log when it cannot be moved, and moves it once that works again", async () => {
    await mkdir(path.join(dataFolder, `${LOG_FILE}.1`), { recursive: true });
    const log = await openLog(dataFolder, () => AT, { maxBytes: 120 });
    const warned: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      warned.push(String(chunk));
      return true;
    };
    try {
      for (let line = 1; line <= 4; line += 1) log.info(`line ${String(line)} ${"x".repeat(30)}`);
      expect(await logged()).toContain("line 4");
      await rm(path.join(dataFolder, `${LOG_FILE}.1`), { recursive: true });
      log.info(`line 5 ${"x".repeat(30)}`);
    } finally {
      process.stderr.write = write;
      await log.close();
    }
    expect(warned).toEqual([]);
    expect(await logged()).toContain("line 5");
    expect(await readFile(path.join(dataFolder, `${LOG_FILE}.1`), "utf8")).toContain("line 4");
  });

  it("is 5 MB by default", () => {
    expect(LOG_LIMIT_BYTES).toBe(5 * 1024 * 1024);
  });

  it("keeps one predecessor of another log, such as the start log, before it grows past the limit", async () => {
    const file = path.join(folder, "start.log");
    await writeFile(file, "a".repeat(11));
    keepOnePrevious(file, 10);
    expect(await readFile(`${file}.1`, "utf8")).toBe("a".repeat(11));
    await writeFile(file, "b".repeat(10));
    keepOnePrevious(file, 10);
    expect(await readFile(file, "utf8")).toBe("b".repeat(10));
    keepOnePrevious(path.join(folder, "fehlt.log"), 10);
  });
});

describe("repeated lines", () => {
  it("writes a line repeated within ten seconds once and then how often it came", async () => {
    let now = AT.getTime();
    const log = await openLog(dataFolder, () => new Date(now));
    log.info("same");
    now += 9_999;
    log.info("same");
    now += 9_999;
    log.info("same");
    log.info("other");
    await log.close();
    expect((await logged()).split("\n").map((line) => line.slice(25))).toEqual([
      "INFO same",
      "INFO the previous message came 2 more times",
      "INFO other",
      "",
    ]);
  });

  it("writes the line again after ten seconds of silence", async () => {
    let now = AT.getTime();
    const log = await openLog(dataFolder, () => new Date(now));
    log.info("same");
    now += 10_000;
    log.info("same");
    await log.close();
    expect((await logged()).split("\n").filter((line) => line.endsWith("INFO same"))).toHaveLength(2);
  });

  it("names the repeats when the log closes", async () => {
    const log = await openLog(dataFolder, () => AT);
    const failure = new Error("x");
    log.error("failed", failure);
    log.error("failed", failure);
    await log.close();
    expect(await logged()).toContain("INFO the previous message came 1 more times");
  });
});
