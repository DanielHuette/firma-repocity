import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isThreshold, readStoredThreshold, storeThreshold, THRESHOLD_FILE, ThresholdError } from "../src/schwelle.ts";

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-schwelle-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("isThreshold", () => {
  it.each([10_000, 200_000, 1_000_000])("accepts %d", (value) => {
    expect(isThreshold(value)).toBe(true);
  });

  it.each([9_999, 1_000_001, 150_000.5, "200000", null, Number.NaN])("rejects %j", (value) => {
    expect(isThreshold(value)).toBe(false);
  });
});

describe("stored threshold", () => {
  it("is missing until it was stored, then read back from the data folder", async () => {
    const dataFolder = path.join(folder, "daten");
    expect(await readStoredThreshold(dataFolder)).toBeUndefined();
    await storeThreshold(dataFolder, 150_000);
    expect(await readStoredThreshold(dataFolder)).toBe(150_000);
    expect(JSON.parse(await readFile(path.join(dataFolder, THRESHOLD_FILE), "utf8"))).toEqual({ schwelleVerdichten: 150_000 });
  });

  it.each(["{kaputt", "[]", '{"schwelleVerdichten": 5}', '{"schwelleVerdichten": "150000"}'])(
    "refuses a damaged file %s and says it can be deleted",
    async (content) => {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, THRESHOLD_FILE), content);
      const failure = readStoredThreshold(folder);
      await expect(failure).rejects.toThrow(ThresholdError);
      await expect(failure).rejects.toThrow("delete");
    },
  );
});
