import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivateFile, hasErrorCode, privacyProblem, privateFolderProblem, writePrivateFile } from "../src/private_datei.ts";

const posixOnly = it.skipIf(process.platform === "win32");

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-privat-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("writePrivateFile", () => {
  it("creates the folder and replaces the file without leaving a temporary file", async () => {
    const file = path.join(folder, "neu", "datei.json");
    await writePrivateFile(file, "eins");
    await writePrivateFile(file, "zwei");
    expect(await readFile(file, "utf8")).toBe("zwei");
    expect(await readdir(path.dirname(file))).toEqual(["datei.json"]);
  });

  it("replaces the file while another reader polls it, as a test or the interface does on Windows", { timeout: 60_000 }, async () => {
    const file = path.join(folder, "zustand.json");
    await writePrivateFile(file, "0");
    const poll = { running: true };
    const reader = (async () => {
      while (poll.running) {
        await readFile(file, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();
    try {
      for (let write = 1; write <= 50; write += 1) await writePrivateFile(file, String(write));
    } finally {
      poll.running = false;
      await reader;
    }
    expect(await readFile(file, "utf8")).toBe("50");
    expect(await readdir(folder)).toEqual(["zustand.json"]);
  });

  posixOnly("makes folder and file private to the owner", async () => {
    const file = path.join(folder, "neu", "datei.json");
    await writePrivateFile(file, "inhalt");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });
});

describe("createPrivateFile", () => {
  it("creates a missing file and leaves an existing one untouched", async () => {
    const file = path.join(folder, "neu", "geheimnis");
    expect(await createPrivateFile(file, "erster")).toBe(true);
    expect(await createPrivateFile(file, "zweiter")).toBe(false);
    expect(await readFile(file, "utf8")).toBe("erster");
    expect(await readdir(path.dirname(file))).toEqual(["geheimnis"]);
  });

  it("lets exactly one of several simultaneous creations win with complete content", async () => {
    const file = path.join(folder, "geheimnis");
    const contents = ["a1", "b2", "c3", "d4", "e5"];
    const created = await Promise.all(contents.map((content) => createPrivateFile(file, content)));
    expect(created.filter(Boolean)).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe(contents[created.indexOf(true)]);
    expect(await readdir(folder)).toEqual(["geheimnis"]);
  });
});

describe("privacyProblem", () => {
  it.skipIf(process.platform !== "win32")("reports nothing on Windows, where modes do not apply", async () => {
    const file = path.join(folder, "geheimnis");
    await writeFile(file, "x");
    expect(await privacyProblem(file)).toBeUndefined();
  });

  posixOnly("accepts a private file in a private folder", async () => {
    const file = path.join(folder, "privat", "geheimnis");
    await writePrivateFile(file, "x");
    expect(await privacyProblem(file)).toBeUndefined();
  });

  posixOnly.each([0o640, 0o604, 0o620])("names the file and chmod 600 when its mode is %o", async (mode) => {
    const file = path.join(folder, "privat", "geheimnis");
    await writePrivateFile(file, "x");
    await chmod(file, mode);
    const problem = await privacyProblem(file);
    expect(problem).toContain(file);
    expect(problem).toContain("chmod 600");
  });

  posixOnly.each([0o750, 0o705])("names the folder and chmod 700 when its mode is %o", async (mode) => {
    const inner = path.join(folder, "privat");
    await mkdir(inner, { mode: 0o700 });
    const file = path.join(inner, "geheimnis");
    await writePrivateFile(file, "x");
    await chmod(inner, mode);
    const problem = await privacyProblem(file);
    expect(problem).toContain(inner);
    expect(problem).toContain("chmod 700");
  });
});

describe("privateFolderProblem", () => {
  it("reports nothing for a folder that does not exist yet", async () => {
    expect(await privateFolderProblem(path.join(folder, "fehlt"))).toBeUndefined();
  });

  posixOnly("accepts a folder private to the owner", async () => {
    const inner = path.join(folder, "daten");
    await mkdir(inner, { mode: 0o700 });
    expect(await privateFolderProblem(inner)).toBeUndefined();
  });

  posixOnly.each([0o750, 0o705])("names the folder and chmod 700 when its mode is %o", async (mode) => {
    const inner = path.join(folder, "daten");
    await mkdir(inner, { mode: 0o700 });
    await chmod(inner, mode);
    const problem = await privateFolderProblem(inner);
    expect(problem).toContain(inner);
    expect(problem).toContain("chmod 700");
  });
});

describe("hasErrorCode", () => {
  it("recognises the code of a file system error only", async () => {
    const error: unknown = await readFile(path.join(folder, "fehlt")).catch((failure: unknown) => failure);
    expect(hasErrorCode(error, "ENOENT")).toBe(true);
    expect(hasErrorCode(error, "EEXIST")).toBe(false);
    expect(hasErrorCode(new Error("ENOENT"), "ENOENT")).toBe(false);
    expect(hasErrorCode("ENOENT", "ENOENT")).toBe(false);
  });
});
