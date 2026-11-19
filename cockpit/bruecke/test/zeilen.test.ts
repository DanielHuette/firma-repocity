import { describe, expect, it } from "vitest";
import { ZeilenLeser } from "../src/zeilen.ts";

function leser(grenze: number): { leser: ZeilenLeser; zeilen: string[]; zuLang: number[] } {
  const zeilen: string[] = [];
  const zuLang: number[] = [];
  return { leser: new ZeilenLeser(grenze, { zeile: (text) => zeilen.push(text), zuLang: (bytes) => zuLang.push(bytes) }), zeilen, zuLang };
}

describe("ZeilenLeser", () => {
  it("joins pieces into lines and keeps a split multi-byte sign whole", () => {
    const t = leser(100);
    const umlaut = Buffer.from("ä", "utf8");
    t.leser.schreiben(Buffer.concat([Buffer.from('{"a":"'), umlaut.subarray(0, 1)]));
    t.leser.schreiben(Buffer.concat([umlaut.subarray(1), Buffer.from('"}\n{"b":1}\n{"c"')]));
    t.leser.schreiben(Buffer.from(":2}\n"));
    expect(t.zeilen).toEqual(['{"a":"ä"}', '{"b":1}', '{"c":2}']);
  });

  it("skips empty lines", () => {
    const t = leser(100);
    t.leser.schreiben(Buffer.from("\n\nx\n\n"));
    expect(t.zeilen).toEqual(["x"]);
  });

  it("passes a line of exactly the limit and drops one byte more, then goes on", () => {
    const t = leser(5);
    t.leser.schreiben(Buffer.from("12345\n123"));
    t.leser.schreiben(Buffer.from("456\nok\n"));
    expect(t.zeilen).toEqual(["12345", "ok"]);
    expect(t.zuLang).toEqual([6]);
  });

  it("gives the last line without a line break at the end", () => {
    const t = leser(100);
    t.leser.schreiben(Buffer.from("letzte"));
    t.leser.ende();
    expect(t.zeilen).toEqual(["letzte"]);
  });
});
