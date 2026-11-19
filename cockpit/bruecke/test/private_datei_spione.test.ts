import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import type * as FilePromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RENAME_ATTEMPTS, writePrivateFile } from "../src/private_datei.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FilePromises>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-umbenennen-"));
  vi.mocked(rename).mockClear();
});

afterEach(async () => {
  vi.mocked(rename).mockReset();
  await rm(folder, { recursive: true, force: true });
});

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("replacing a file that is briefly in use", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("tries again after %s and writes the file", async (code) => {
    vi.mocked(rename).mockRejectedValueOnce(failure(code)).mockRejectedValueOnce(failure(code));
    const file = path.join(folder, "datei.json");
    await writePrivateFile(file, "inhalt", "win32");
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(3);
    expect(await readdir(folder)).toEqual(["datei.json"]);
  });

  it("gives up after a fixed number of attempts, reports the error and leaves no temporary file", async () => {
    vi.mocked(rename).mockRejectedValue(failure("EPERM"));
    await expect(writePrivateFile(path.join(folder, "datei.json"), "inhalt", "win32")).rejects.toThrow("EPERM");
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(RENAME_ATTEMPTS);
    expect(await readdir(folder)).toEqual([]);
  });

  it.each(["linux", "darwin"] as const)("does not try again on %s, where renaming over an open file works", async (platform) => {
    vi.mocked(rename).mockRejectedValueOnce(failure("EPERM"));
    await expect(writePrivateFile(path.join(folder, "datei.json"), "inhalt", platform)).rejects.toThrow("EPERM");
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1);
    expect(await readdir(folder)).toEqual([]);
  });

  it("does not try again after an error that waiting does not fix", async () => {
    vi.mocked(rename).mockRejectedValueOnce(failure("ENOSPC"));
    await expect(writePrivateFile(path.join(folder, "datei.json"), "inhalt", "win32")).rejects.toThrow("ENOSPC");
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1);
    expect(await readdir(folder)).toEqual([]);
  });
});
