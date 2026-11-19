import { describe, expect, it } from "vitest";
import { bloecke, inline, type Block, type Inline } from "./markdown";

function inlineArten(teile: readonly Inline[]): string[] {
  return teile.flatMap((teil) => ("inhalt" in teil ? [teil.art, ...inlineArten(teil.inhalt)] : [teil.art]));
}

function alleInline(liste: readonly Block[]): Inline[] {
  return liste.flatMap((block): Inline[] => {
    switch (block.art) {
      case "absatz":
      case "ueberschrift":
        return [...block.inhalt];
      case "liste":
        return block.punkte.flatMap((punkt) => [...punkt.inhalt, ...alleInline(punkt.unter === null ? [] : [punkt.unter])]);
      case "zitat":
        return alleInline(block.inhalt);
      case "tabelle":
        return [...block.kopf, ...block.zeilen].flat(2);
      case "code":
      case "linie":
        return [];
    }
  });
}

function links(liste: readonly Block[]): string[] {
  const sammeln = (teile: readonly Inline[]): string[] => teile.flatMap((teil) => {
    if (teil.art === "link") return [teil.ziel, ...sammeln(teil.inhalt)];
    return "inhalt" in teil ? sammeln(teil.inhalt) : [];
  });
  return sammeln(alleInline(liste));
}

function text(teile: readonly Inline[]): string {
  return teile.map((teil) => {
    if (teil.art === "text" || teil.art === "code") return teil.text;
    if (teil.art === "umbruch") return "\n";
    return text(teil.inhalt);
  }).join("");
}

describe("inline", () => {
  it("reads bold, italic and inline code", () => {
    expect(inline("a **fett** b *schräg* c `x < y`")).toEqual([
      { art: "text", text: "a " }, { art: "fett", inhalt: [{ art: "text", text: "fett" }] }, { art: "text", text: " b " },
      { art: "kursiv", inhalt: [{ art: "text", text: "schräg" }] }, { art: "text", text: " c " }, { art: "code", text: "x < y" },
    ]);
  });

  it("reads underscores as bold and italic, but not inside words", () => {
    expect(inlineArten(inline("__fett__ _schräg_ snake_case_name"))).toEqual(["fett", "text", "text", "kursiv", "text", "text"]);
    expect(text(inline("snake_case_name"))).toBe("snake_case_name");
  });

  it("reads italic inside bold", () => {
    expect(inline("**ganz *innen* fett**")).toEqual([{ art: "fett", inhalt: [{ art: "text", text: "ganz " }, { art: "kursiv", inhalt: [{ art: "text", text: "innen" }] }, { art: "text", text: " fett" }] }]);
  });

  it("reads markdown links to http and https", () => {
    expect(inline("[Doku](https://code.claude.com/docs) und [alt](http://example.com/a?b=1)")).toEqual([
      { art: "link", ziel: "https://code.claude.com/docs", inhalt: [{ art: "text", text: "Doku" }] }, { art: "text", text: " und " },
      { art: "link", ziel: "http://example.com/a?b=1", inhalt: [{ art: "text", text: "alt" }] },
    ]);
  });

  it("links bare web addresses without the closing punctuation", () => {
    expect(inline("Siehe https://example.com/pfad.")).toEqual([
      { art: "text", text: "Siehe " }, { art: "link", ziel: "https://example.com/pfad", inhalt: [{ art: "text", text: "https://example.com/pfad" }] }, { art: "text", text: "." },
    ]);
  });

  it("turns a line break into a break", () => {
    expect(inline("eins\nzwei")).toEqual([{ art: "text", text: "eins" }, { art: "umbruch" }, { art: "text", text: "zwei" }]);
  });

  it("keeps markup inside inline code as text", () => {
    expect(inline("`**nicht fett** [a](https://x.y)`")).toEqual([{ art: "code", text: "**nicht fett** [a](https://x.y)" }]);
  });
});

describe("inline against injected code", () => {
  it.each([
    ["a script tag", "<script>alert(1)</script>"],
    ["an image with onerror", "<img src=x onerror=alert(1)>"],
    ["a markdown image with an onerror address", "![x](x\" onerror=\"alert(1))"],
  ])("keeps %s as plain text", (_name, eingabe) => {
    const teile = inline(eingabe);
    expect(inlineArten(teile).every((art) => art === "text")).toBe(true);
    expect(text(teile)).toBe(eingabe);
  });

  it.each([
    "[klick](javascript:alert(1))",
    "[klick](JavaScript:alert(1))",
    "[klick](data:text/html,<script>alert(1)</script>)",
    "[klick](vbscript:msgbox(1))",
    "[klick](//evil.example/x)",
    "[klick](/relativ)",
  ])("never links %s", (eingabe) => {
    expect(links(bloecke(eingabe))).toEqual([]);
    expect(text(inline(eingabe))).toBe(eingabe);
  });

  it("does not link a markdown image, it shows the address as a link at most", () => {
    expect(links(bloecke("![Bild](https://example.com/b.png)"))).toEqual(["https://example.com/b.png"]);
    expect(inlineArten(inline("![Bild](https://example.com/b.png)"))).not.toContain("bild");
  });

  it("does not link a javascript address hidden behind spaces or a tab", () => {
    expect(links(bloecke("[a]( javascript:alert(1))"))).toEqual([]);
    expect(links(bloecke("[a](java\tscript:alert(1))"))).toEqual([]);
  });
});

describe("bloecke", () => {
  it("splits paragraphs at empty lines", () => {
    expect(bloecke("eins\n\nzwei")).toEqual([
      { art: "absatz", inhalt: [{ art: "text", text: "eins" }] }, { art: "absatz", inhalt: [{ art: "text", text: "zwei" }] },
    ]);
  });

  it("reads a fenced code block with language and keeps its content unparsed", () => {
    expect(bloecke("```ts\nconst a = **1**;\n<b>x</b>\n```\nnach")).toEqual([
      { art: "code", sprache: "ts", text: "const a = **1**;\n<b>x</b>" }, { art: "absatz", inhalt: [{ art: "text", text: "nach" }] },
    ]);
  });

  it("reads an unclosed code block up to the end, as while Claude still writes", () => {
    expect(bloecke("```\nerste Zeile")).toEqual([{ art: "code", sprache: "", text: "erste Zeile" }]);
  });

  it("reads headings", () => {
    expect(bloecke("# Eins\n### Drei")).toEqual([
      { art: "ueberschrift", stufe: 1, inhalt: [{ art: "text", text: "Eins" }] }, { art: "ueberschrift", stufe: 3, inhalt: [{ art: "text", text: "Drei" }] },
    ]);
  });

  it("reads a bullet list with a nested list", () => {
    expect(bloecke("- a\n  - a1\n- b")).toEqual([{
      art: "liste", geordnet: false, start: 1, punkte: [
        { inhalt: [{ art: "text", text: "a" }], unter: { art: "liste", geordnet: false, start: 1, punkte: [{ inhalt: [{ art: "text", text: "a1" }], unter: null }] } },
        { inhalt: [{ art: "text", text: "b" }], unter: null },
      ],
    }]);
  });

  it("reads a numbered list with its start number and continuation lines", () => {
    expect(bloecke("3. drei\n   weiter\n4) vier")).toEqual([{
      art: "liste", geordnet: true, start: 3, punkte: [
        { inhalt: [{ art: "text", text: "drei" }, { art: "umbruch" }, { art: "text", text: "weiter" }], unter: null },
        { inhalt: [{ art: "text", text: "vier" }], unter: null },
      ],
    }]);
  });

  it("reads a quote and a rule", () => {
    expect(bloecke("> zitiert\n\n---")).toEqual([{ art: "zitat", inhalt: [{ art: "absatz", inhalt: [{ art: "text", text: "zitiert" }] }] }, { art: "linie" }]);
  });

  it("reads a table with header and rows", () => {
    expect(bloecke("| A | **B** |\n|---|:--:|\n| 1 | 2 |")).toEqual([{
      art: "tabelle",
      kopf: [[{ art: "text", text: "A" }], [{ art: "fett", inhalt: [{ art: "text", text: "B" }] }]],
      zeilen: [[[{ art: "text", text: "1" }], [{ art: "text", text: "2" }]]],
    }]);
  });

  it("keeps a lone line with pipes as a paragraph", () => {
    expect(bloecke("a | b")).toEqual([{ art: "absatz", inhalt: [{ art: "text", text: "a | b" }] }]);
  });

  it("keeps html blocks as text", () => {
    expect(bloecke("<div onclick=\"x()\">\n<script>alert(1)</script>\n</div>")).toEqual([
      { art: "absatz", inhalt: [{ art: "text", text: "<div onclick=\"x()\">" }, { art: "umbruch" }, { art: "text", text: "<script>alert(1)</script>" }, { art: "umbruch" }, { art: "text", text: "</div>" }] },
    ]);
  });

  it("reads windows line ends like unix ones", () => {
    expect(bloecke("eins\r\n\r\nzwei")).toEqual(bloecke("eins\n\nzwei"));
  });

  it("reads nothing from empty text", () => {
    expect(bloecke("")).toEqual([]);
    expect(bloecke("\n\n  \n")).toEqual([]);
  });
});
