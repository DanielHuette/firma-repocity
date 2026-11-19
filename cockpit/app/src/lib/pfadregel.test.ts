import { describe, expect, it } from "vitest";
import { istKommandozentrale, manifestFuer } from "./pfadregel";

describe("istKommandozentrale", () => {
  it.each([
    ["/kommandozentrale", true], ["/kommandozentrale/", true], ["/kommandozentrale/irgendwas", true],
    ["/", false], ["/kommandozentraleX", false], ["/Kommandozentrale", false], ["/radarauditor", false], ["/x/kommandozentrale", false],
  ])("reads %s as %s", (pfad, erwartet) => {
    expect(istKommandozentrale(pfad)).toBe(erwartet);
  });
});

describe("manifestFuer", () => {
  it.each([
    ["/kommandozentrale", "/kommandozentrale.webmanifest"], ["/kommandozentrale/x", "/kommandozentrale.webmanifest"],
    ["/", "/manifest.webmanifest"], ["/assistent", "/manifest.webmanifest"], ["/kommandozentraleX", "/manifest.webmanifest"],
  ])("installs %s with %s", (pfad, erwartet) => {
    expect(manifestFuer(pfad)).toBe(erwartet);
  });
});
