import { useMemo } from "preact/hooks";
import { bloecke, type Block, type Inline, type Liste } from "./markdown";

const KOPF_STUFEN = ["h3", "h4", "h5"] as const;

function InlineTeil({ teil }: { teil: Inline }) {
  switch (teil.art) {
    case "text":
      return <>{teil.text}</>;
    case "code":
      return <code>{teil.text}</code>;
    case "umbruch":
      return <br />;
    case "fett":
      return <strong><InlineTeile teile={teil.inhalt} /></strong>;
    case "kursiv":
      return <em><InlineTeile teile={teil.inhalt} /></em>;
    case "link":
      return <a href={teil.ziel} target="_blank" rel="noopener noreferrer"><InlineTeile teile={teil.inhalt} /></a>;
  }
}

function InlineTeile({ teile }: { teile: readonly Inline[] }) {
  return <>{teile.map((teil, stelle) => <InlineTeil key={stelle} teil={teil} />)}</>;
}

function ListenBlock({ liste }: { liste: Liste }) {
  const punkte = liste.punkte.map((punkt, stelle) => (
    <li key={stelle}><InlineTeile teile={punkt.inhalt} />{punkt.unter !== null && <ListenBlock liste={punkt.unter} />}</li>
  ));
  return liste.geordnet ? <ol start={liste.start}>{punkte}</ol> : <ul>{punkte}</ul>;
}

function Tabelle({ block }: { block: Extract<Block, { art: "tabelle" }> }) {
  return (
    <div class="kz-md__tabelle">
      <table>
        <thead><tr>{block.kopf.map((zelle, stelle) => <th key={stelle} scope="col"><InlineTeile teile={zelle} /></th>)}</tr></thead>
        <tbody>{block.zeilen.map((zeile, nummer) => <tr key={nummer}>{zeile.map((zelle, stelle) => <td key={stelle}><InlineTeile teile={zelle} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function BlockTeil({ block }: { block: Block }) {
  switch (block.art) {
    case "absatz":
      return <p><InlineTeile teile={block.inhalt} /></p>;
    case "ueberschrift": {
      const Kopf = KOPF_STUFEN[Math.min(block.stufe, KOPF_STUFEN.length) - 1] ?? "h5";
      return <Kopf class="kz-md__kopf"><InlineTeile teile={block.inhalt} /></Kopf>;
    }
    case "code":
      return <pre class="kz-md__code" data-sprache={block.sprache === "" ? undefined : block.sprache}><code>{block.text}</code></pre>;
    case "zitat":
      return <blockquote><BlockTeile liste={block.inhalt} /></blockquote>;
    case "tabelle":
      return <Tabelle block={block} />;
    case "linie":
      return <hr />;
    case "liste":
      return <ListenBlock liste={block} />;
  }
}

function BlockTeile({ liste }: { liste: readonly Block[] }) {
  return <>{liste.map((block, stelle) => <BlockTeil key={stelle} block={block} />)}</>;
}

export function MarkdownAnsicht({ text, laufend = false }: { text: string; laufend?: boolean }) {
  const liste = useMemo(() => bloecke(text), [text]);
  return <div class={laufend ? "kz-md kz-md--laufend" : "kz-md"}><BlockTeile liste={liste} /></div>;
}
