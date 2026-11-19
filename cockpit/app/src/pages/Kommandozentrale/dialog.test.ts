import { describe, expect, it } from "vitest";
import { ausserhalb } from "./Dialog";

const RAHMEN = { left: 100, top: 50, right: 500, bottom: 450 };

describe("ausserhalb", () => {
  it.each([[99, 200, true], [100, 200, false], [500, 200, false], [501, 200, true], [300, 49, true], [300, 50, false], [300, 450, false], [300, 451, true]])(
    "says whether %i,%i lies beside the window: %s",
    (x, y, erwartet) => {
      expect(ausserhalb(RAHMEN, x, y)).toBe(erwartet);
    },
  );
});
