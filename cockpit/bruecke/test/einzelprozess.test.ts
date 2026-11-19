import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlreadyRunningError, claimSingleProcess, LOCK_FILE } from "../src/einzelprozess.ts";

let folder: string;
let dataFolder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-einzel-"));
  dataFolder = path.join(folder, "daten");
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function endedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
  await new Promise((resolve) => child.on("exit", resolve));
  if (child.pid === undefined) throw new Error("no process id");
  return child.pid;
}

describe("claimSingleProcess", () => {
  it("creates the lock file with the process id in the data folder and removes it on release", async () => {
    const release = await claimSingleProcess(dataFolder);
    expect(await readFile(path.join(dataFolder, LOCK_FILE), "utf8")).toBe(String(process.pid));
    await release();
    expect(await readdir(dataFolder)).toEqual([]);
  });

  it("refuses a second claim while the first process runs and names the process and the file", async () => {
    const release = await claimSingleProcess(dataFolder);
    const failure = claimSingleProcess(dataFolder);
    await expect(failure).rejects.toThrow(AlreadyRunningError);
    await expect(failure).rejects.toThrow(String(process.pid));
    await expect(failure).rejects.toThrow(path.join(dataFolder, LOCK_FILE));
    await release();
  });

  it("allows a new claim after the release", async () => {
    await (await claimSingleProcess(dataFolder))();
    const again = await claimSingleProcess(dataFolder);
    await again();
  });

  it("takes over the lock of a process that no longer runs", async () => {
    await claimSingleProcess(dataFolder);
    const ended = await endedProcessId();
    await writeFile(path.join(dataFolder, LOCK_FILE), String(ended));
    const release = await claimSingleProcess(dataFolder);
    expect(await readFile(path.join(dataFolder, LOCK_FILE), "utf8")).toBe(String(process.pid));
    await release();
  });

  it.each(["", "kaputt", "0", "-5", "12.5"])("takes over a lock file holding %j", async (content) => {
    await claimSingleProcess(dataFolder);
    await writeFile(path.join(dataFolder, LOCK_FILE), content);
    const release = await claimSingleProcess(dataFolder);
    await release();
  });

  it("leaves the lock of another process in place on release", async () => {
    const release = await claimSingleProcess(dataFolder);
    await writeFile(path.join(dataFolder, LOCK_FILE), "424242");
    await release();
    expect(await readFile(path.join(dataFolder, LOCK_FILE), "utf8")).toBe("424242");
  });

  it("lets exactly one of several simultaneous claims win", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => claimSingleProcess(dataFolder)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(AlreadyRunningError);
    }
  });
});
