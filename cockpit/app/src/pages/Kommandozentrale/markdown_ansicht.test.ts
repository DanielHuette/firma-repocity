import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { MarkdownAnsicht } from "./MarkdownAnsicht";

const zeigen = (text: string) => renderToString(h(MarkdownAnsicht, { text }));

describe("Markdown on the page", () => {
  it.each([
    ["a script tag", "<script>alert(1)</script>", "&lt;script>alert(1)&lt;/script>"],
    ["an image with onerror", "<img src=x onerror=alert(1)>", "&lt;img src=x onerror=alert(1)>"],
    ["html inside a code block", "```\n<script>alert(1)</script>\n```", "&lt;script>alert(1)&lt;/script>"],
    ["html inside inline code", "`<b onmouseover=x()>`", "<code>&lt;b onmouseover=x()></code>"],
  ])("shows %s as text, never as markup", (_name, text, sichtbar) => {
    const html = zeigen(text);
    expect(html).toContain(sichtbar);
    expect(html).not.toMatch(/<(script|img|b)[\s>]/i);
  });

  it.each(["[klick](javascript:alert(1))", "[klick](data:text/html,x)", "![x](javascript:alert(1))"])("never builds a link for %s", (text) => {
    expect(zeigen(text)).not.toContain("<a");
  });

  it("opens web links in a new tab without access to this page", () => {
    expect(zeigen("[Doku](https://example.com/a?b=1&c=2)")).toBe(
      '<div class="kz-md"><p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">Doku</a></p></div>',
    );
  });

  it("escapes quotes in a link address so it cannot leave the attribute", () => {
    expect(zeigen('https://example.com/"onmouseover="x')).not.toContain('" onmouseover');
  });

  it("shows paragraphs, lists, emphasis and code", () => {
    expect(zeigen("**fett** und *schräg*\n\n- `a`\n- b\n\n```ts\nx\n```")).toBe(
      '<div class="kz-md"><p><strong>fett</strong> und <em>schräg</em></p><ul><li><code>a</code></li><li>b</li></ul>'
      + '<pre class="kz-md__code" data-sprache="ts"><code>x</code></pre></div>',
    );
  });

  it("marks text Claude is still writing", () => {
    expect(renderToString(h(MarkdownAnsicht, { text: "x", laufend: true }))).toBe('<div class="kz-md kz-md--laufend"><p>x</p></div>');
  });
});
