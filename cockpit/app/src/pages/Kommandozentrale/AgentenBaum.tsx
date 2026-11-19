import { useId } from "preact/hooks";
import { baumAnordnung, brauchtDich, kuerzen, platzFuer, unterzeile, type Baum, type Kante, type Knoten } from "./baum";
import { SEIT_UPDATE } from "./Kontextleiste";
import { fortschrittAnzeige, type FortschrittAnzeige } from "./ordnung";
import type { SitzungsZustand } from "./verbindung";

const ECKE = 6;
const VERSATZ_S = 0.7;
const ERLEDIGT = " ✓";
const BALKEN_EINZUG = 10;
const BALKEN_ABSTAND_UNTEN = 5;

function Linie({ kante, stelle }: { kante: Kante; stelle: number }) {
  const verzoegerung = { animationDelay: `${String(-stelle * VERSATZ_S)}s` };
  return (
    <>
      <path d={kante.pfad} class={`kz-edge kz-edge--${kante.stand}`} />
      {kante.fliesst && <path d={kante.pfad} class="kz-flow" pathLength={1} style={verzoegerung} />}
      {kante.fliesst && <path d={kante.pfad} class="kz-head" pathLength={1} style={verzoegerung} />}
    </>
  );
}

function Ecken({ links, oben, breite, hoehe }: { links: number; oben: number; breite: number; hoehe: number }) {
  const rechts = links + breite;
  const unten = oben + hoehe;
  const ecken = [[links, oben, 1, 1], [rechts, oben, -1, 1], [links, unten, 1, -1], [rechts, unten, -1, -1]] as const;
  return (
    <>
      {ecken.map(([x, y, dx, dy]) => (
        <path key={`${String(x)}-${String(y)}`} class="kz-node__ecke" d={`M${String(x + dx * ECKE)} ${String(y)} L${String(x)} ${String(y)} L${String(x)} ${String(y + dy * ECKE)}`} />
      ))}
    </>
  );
}

function KnotenBalken({ anzeige, links, unten, breite }: { anzeige: FortschrittAnzeige; links: number; unten: number; breite: number }) {
  if (anzeige.kind === "keiner") return null;
  const x = links + BALKEN_EINZUG;
  const y = unten - BALKEN_ABSTAND_UNTEN;
  const laenge = breite - 2 * BALKEN_EINZUG;
  return (
    <g class="kz-node__balken">
      <line class="kz-node__spur" x1={x} y1={y} x2={x + laenge} y2={y} />
      {anzeige.kind === "zahl"
        ? anzeige.anteil > 0 && <line class="kz-node__fuellung" x1={x} y1={y} x2={x + laenge * anzeige.anteil} y2={y} />
        : <line class="kz-node__lauf" x1={x} y1={y} x2={x + laenge} y2={y} pathLength={1} />}
    </g>
  );
}

function knotenTitel(knoten: Knoten, anzeige: FortschrittAnzeige): string {
  const { agent } = knoten;
  const teile = [agent.name, unterzeile(agent)];
  if (agent.skills.length > 0) teile.push(`Skills: ${agent.skills.join(", ")}`);
  if (anzeige.kind === "zahl") teile.push(`${anzeige.text} Aufgaben erledigt`);
  return teile.join(" · ");
}

function KnotenBild({ knoten, hoehe, fuellung }: { knoten: Knoten; hoehe: number; fuellung: string }) {
  const { agent, x, y, breite } = knoten;
  const links = x - breite / 2;
  const zeichen = platzFuer(breite);
  const name = agent.name + (agent.stand === "fertig" ? ERLEDIGT : "");
  const fortschritt = fortschrittAnzeige(agent);
  return (
    <g class={`kz-node kz-node--${agent.stand}`}>
      <title>{knotenTitel(knoten, fortschritt)}</title>
      <rect class="kz-node__b" x={links} y={y} width={breite} height={hoehe} rx={3} fill={fuellung} />
      <Ecken links={links} oben={y} breite={breite} hoehe={hoehe} />
      <circle class="kz-node__punkt" cx={links + 10} cy={y + 15} r={3} />
      <text class="kz-node__name" x={links + 18} y={y + 18}>{kuerzen(name, zeichen)}</text>
      <text class="kz-node__sub" x={links + 10} y={y + 33}>{kuerzen(unterzeile(agent), zeichen + 1)}</text>
      <KnotenBalken anzeige={fortschritt} links={links} unten={y + hoehe} breite={breite} />
    </g>
  );
}

function Zeichnung({ baum }: { baum: Baum }) {
  const verlauf = `kz-ng-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const laufend = baum.knoten.filter((knoten) => knoten.agent.stand === "laeuft").length;
  return (
    <svg class="kz-baum__svg" viewBox={`0 0 ${String(baum.breite)} ${String(baum.hoehe)}`} role="img" aria-label={`Agenten-Baum mit ${String(baum.knoten.length)} Agenten, ${String(laufend)} laufen`}>
      <defs>
        <linearGradient id={verlauf} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#13294a" />
          <stop offset="1" stop-color="#08142a" />
        </linearGradient>
      </defs>
      {baum.kanten.map((kante, stelle) => <Linie key={kante.zu.agent.id} kante={kante} stelle={stelle} />)}
      {baum.knoten.map((knoten) => <KnotenBild key={knoten.agent.id} knoten={knoten} hoehe={baum.knotenHoehe} fuellung={`url(#${verlauf})`} />)}
    </svg>
  );
}

function Legende() {
  return (
    <div class="kz-legend" aria-hidden="true">
      <span><b />läuft</span>
      <span><b class="kz-legend--f" />fertig</span>
      <span>◆ wartet auf dich</span>
      <span><i class="kz-legend__balken" />Aufgaben</span>
    </div>
  );
}

function zumWarten(): void {
  document.getElementById("kz-wartet")?.scrollIntoView({ block: "nearest" });
}

function BrauchtDich({ namen }: { namen: readonly string[] }) {
  return (
    <>
      {namen.map((name, stelle) => (
        <button key={`${name}-${String(stelle)}`} type="button" class="kz-needs" onClick={zumWarten}>
          <span class="kz-dot kz-dot--wartet" aria-hidden="true" />
          {name} braucht dich<small>→</small>
        </button>
      ))}
    </>
  );
}

export function AgentenBaum({ sitzung, keineDaten }: { sitzung: SitzungsZustand | null; keineDaten: boolean }) {
  const agenten = sitzung?.agenten ?? [];
  const baum = baumAnordnung(agenten);
  return (
    <section class="kz-panel kz-baum" aria-labelledby="kz-baum-titel">
      <h2 class="kz-ph" id="kz-baum-titel">Agenten-Baum</h2>
      <div class="kz-pb">
        {keineDaten && <p class="kz-seit-update" role="status">Agenten-Baum: {SEIT_UPDATE}</p>}
        {baum.knoten.length === 0 ? <p class="kz-leer">Keine Sitzung gewählt.</p> : <Zeichnung baum={baum} />}
        <Legende />
        <BrauchtDich namen={brauchtDich(agenten)} />
      </div>
    </section>
  );
}
