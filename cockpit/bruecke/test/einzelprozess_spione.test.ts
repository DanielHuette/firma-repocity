import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlreadyRunningError, claimSingleProcess } from "../src/einzelprozess.ts";
import { createPrivateFile } from "../src/private_datei.ts";
import type * as PrivateFile from "../src/private_datei.ts";

vi.mock("../src/private_datei.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof PrivateFile>();
  return { ...actual, createPrivateFile: vi.fn(actual.createPrivateFile) };
});

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-einzel-spione-"));
});

afterEach(async () => {
  vi.mocked(createPrivateFile).mockReset();
  await rm(folder, { recursive: true, force: true });
});

describe("claimSingleProcess against another start at the same moment", () => {
  it("gives up when another start takes the lock between removing a stale lock and creating its own", async () => {
    vi.mocked(createPrivateFile).mockResolvedValue(false);
    const failure = claimSingleProcess(path.join(folder, "daten"));
    await expect(failure).rejects.toThrow(AlreadyRunningError);
    await expect(failure).rejects.toThrow("at the same moment");
    expect(vi.mocked(createPrivateFile)).toHaveBeenCalledTimes(2);
  });
});
