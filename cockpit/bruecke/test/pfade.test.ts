import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInside } from "../src/pfade.ts";

const base = path.join(tmpdir(), "bruecke-pfade", "ordner");

describe("isInside", () => {
  it.each([
    ["the folder itself", base],
    ["a file in the folder", path.join(base, "datei")],
    ["a deeper folder", path.join(base, "a", "b")],
    ["a name starting with two dots", path.join(base, "..versteckt")],
  ])("accepts %s", (_case, candidate) => {
    expect(isInside(base, candidate)).toBe(true);
  });

  it.each([
    ["the parent folder", path.dirname(base)],
    ["a sibling with the same beginning", `${base}-zwei`],
    ["a sibling", path.join(path.dirname(base), "anderer")],
    ["another drive or root", path.join(path.parse(base).root, "woanders")],
  ])("rejects %s", (_case, candidate) => {
    expect(isInside(base, candidate)).toBe(false);
  });
});
