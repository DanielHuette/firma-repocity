import { useState } from "preact/hooks";
import { favorit, haken, type Bestand, type HakenArt } from "./bestand";
import { konnektorGruppen, sammlungUmschalten, skillGruppen, type Eintrag, type Gruppe, type Sammlung } from "./ordnung";
import type { ClientNachricht, SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

export type HakenFensterArt = "skills" | "konnektoren";

const AUS_HINWEIS = "Haken weg heißt: nicht mehr anwenden (Hinweis an Claude).";
const ART_TEXT: Readonly<Record<HakenArt, string>> = { skill: "Skill", plugin: "Plugin", konnektor: "Konnektor" };

export function Stern({ an, name, gesperrt, onWechsel }: { an: boolean; name: string; gesperrt: boolean; onWechsel: () => void }) {
  const titel = an ? `${name} nicht mehr als Favorit` : `${name} als Favorit oben zeigen`;
  return (
    <button type="button" class={an ? "kz-stern kz-stern--an" : "kz-stern"} aria-pressed={an} aria-label={titel} title={titel} disabled={gesperrt} onClick={onWechsel}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.1 4.1 13.3l.9-4.3L1.8 6.1l4.3-.5z" /></svg>
    </button>
  );
}

function HakenFeld({ an, teils = false, gesperrt, beschriftung, titel, onWechsel }: {
  an: boolean; teils?: boolean; gesperrt: boolean; beschriftung: string; titel: string; onWechsel: (an: boolean) => void;
}) {
  return (
    <input type="checkbox" class="kz-hk__feld" checked={an} disabled={gesperrt} aria-label={beschriftung} title={titel}
      ref={(feld) => { if (feld !== null) feld.indeterminate = teils; }} onChange={(ereignis) => { onWechsel(ereignis.currentTarget.checked); }} />
  );
}

interface Handlungen {
  readonly gesperrt: boolean;
  readonly umschalten: (eintrag: Eintrag, an: boolean) => void;
  readonly sammlung: (sammlung: Sammlung) => void;
  readonly favorisieren: (eintrag: Eintrag) => void;
}

function hakenTitel(eintrag: Eintrag): string {
  if (eintrag.immer) return "immer aktiv – kommt über CLAUDE.md oder ein Plugin";
  if (eintrag.hinweis !== null && !eintrag.schaltbar) return eintrag.hinweis;
  return eintrag.an ? AUS_HINWEIS : "Für diese Sitzung anhaken";
}

function EintragZeile({ eintrag, tun, mitStern = true }: { eintrag: Eintrag; tun: Handlungen; mitStern?: boolean }) {
  const feldGesperrt = tun.gesperrt || !eintrag.schaltbar;
  return (
    <li class={eintrag.an ? "kz-hk kz-hk--an" : "kz-hk"}>
      {mitStern ? <Stern an={eintrag.favorit} name={eintrag.name} gesperrt={tun.gesperrt} onWechsel={() => { tun.favorisieren(eintrag); }} /> : <span class="kz-hk__einzug" />}
      <label class="kz-hk__text">
        <span class="kz-hk__name">
          {eintrag.name}
          {eintrag.art !== "skill" && <span class="kz-tag">{ART_TEXT[eintrag.art]}</span>}
          {eintrag.hinweis !== null && <span class="kz-hk__hinweis">{eintrag.hinweis}</span>}
        </span>
        {eintrag.beschreibung !== "" && <span class="kz-klein kz-hk__beschreibung">{eintrag.beschreibung}</span>}
        <HakenFeld an={eintrag.an} gesperrt={feldGesperrt} beschriftung={`${eintrag.name} für diese Sitzung`} titel={hakenTitel(eintrag)} onWechsel={(an) => { tun.umschalten(eintrag, an); }} />
      </label>
    </li>
  );
}

function SammlungZeile({ sammlung, tun, offen }: { sammlung: Sammlung; tun: Handlungen; offen: boolean }) {
  const anzahl = sammlung.mitglieder.length;
  return (
    <li class={sammlung.an === "nein" ? "kz-hk kz-hk--sammlung" : "kz-hk kz-hk--sammlung kz-hk--an"}>
      <details class="kz-hk__sammlung" open={offen}>
        <summary>
          <span class="kz-werkzeug__pfeil" aria-hidden="true">▸</span>
          <span class="kz-hk__name">{sammlung.name}</span>
          <span class="kz-klein">Sammlung · {anzahl} {anzahl === 1 ? "Skill" : "Skills"}</span>
        </summary>
        <ul class="kz-hk__mitglieder">{sammlung.mitglieder.map((mitglied) => <EintragZeile key={mitglied.kennung} eintrag={mitglied} tun={tun} />)}</ul>
      </details>
      <HakenFeld an={sammlung.an === "ja"} teils={sammlung.an === "teils"} gesperrt={tun.gesperrt || !sammlung.schaltbar} beschriftung={`Ganze Sammlung ${sammlung.name} für diese Sitzung`}
        titel={sammlung.an === "ja" ? AUS_HINWEIS : "Alle Skills der Sammlung anhaken"} onWechsel={() => { tun.sammlung(sammlung); }} />
    </li>
  );
}

function GruppenListe({ gruppen, tun, suche }: { gruppen: readonly Gruppe[]; tun: Handlungen; suche: string }) {
  if (gruppen.length === 0) return <p class="kz-leer">Nichts gefunden.</p>;
  return (
    <>
      {gruppen.map((gruppe) => (
        <section key={gruppe.titel} class="kz-hk-gruppe" aria-label={gruppe.titel}>
          <h3 class="kz-unterkopf">{gruppe.titel}</h3>
          <ul class="kz-hk-liste">
            {gruppe.zeilen.map((zeile) => (zeile.kind === "sammlung"
              ? <SammlungZeile key={`s-${zeile.name}`} sammlung={zeile} tun={tun} offen={suche.trim() !== ""} />
              : <EintragZeile key={`${zeile.art}-${zeile.kennung}`} eintrag={zeile} tun={tun} />))}
          </ul>
        </section>
      ))}
    </>
  );
}

export interface HakenFensterProps {
  readonly art: HakenFensterArt;
  readonly bestand: Bestand | null;
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
}

function sperrText(sitzung: SitzungsZustand | null, steuernd: boolean): string | null {
  if (!steuernd) return "Haken setzen kann nur das steuernde Gerät.";
  if (sitzung === null) return "Erst eine Sitzung wählen: Die Haken gelten nur für die gewählte Sitzung.";
  return null;
}

export function HakenFenster({ art, bestand, sitzung, steuernd, senden }: HakenFensterProps) {
  const [suche, setSuche] = useState("");
  const [fehler, setFehler] = useState(false);
  const schicken = (nachrichten: readonly ClientNachricht[]) => { setFehler(!nachrichten.every((nachricht) => senden(nachricht))); };
  const tun: Handlungen = {
    gesperrt: !steuernd,
    umschalten: (eintrag, an) => { if (sitzung !== null) schicken([haken(sitzung.id, eintrag.art, eintrag.kennung, an)]); },
    sammlung: (eintrag) => { if (sitzung !== null) schicken(sammlungUmschalten(sitzung.id, eintrag)); },
    favorisieren: (eintrag) => { schicken([favorit(eintrag.art, eintrag.kennung, !eintrag.favorit), { typ: "bestand_holen" }]); },
  };
  const gruppen = bestand === null ? [] : art === "skills" ? skillGruppen(bestand, sitzung, suche) : konnektorGruppen(bestand, sitzung, suche);
  const sperre = sperrText(sitzung, steuernd);
  const was = art === "skills" ? "Skills und Plugins" : "Konnektoren";
  return (
    <div class="kz-fensterinhalt">
      <label class="kz-feld">Suchen<input value={suche} onInput={(ereignis) => { setSuche(ereignis.currentTarget.value); }} placeholder={`Name oder Beschreibung der ${was}`} autoFocus /></label>
      {sperre !== null && <p class="kz-klein" role="status">{sperre}</p>}
      {sitzung !== null && (
        <p class="kz-klein">
          Haken gelten nur für „{sitzung.titel}“. {art === "skills" ? "Skills wirken mit deiner nächsten Nachricht, Plugins sofort." : "Konnektoren wirken sofort."}
          {sitzung.neustartAusstehend && <strong class="kz-hk__neustart"> Wird beim nächsten Schritt neu verbunden.</strong>}
          {art === "konnektoren" && sitzung.konnektoren === null && <strong class="kz-hk__neustart"> Welche Konnektoren laufen, ist noch unbekannt, bis Claude Code in dieser Sitzung gestartet ist.</strong>}
        </p>
      )}
      {bestand === null ? <p class="kz-leer" role="status">Lädt die Liste von der Brücke …</p> : <GruppenListe gruppen={gruppen} tun={tun} suche={suche} />}
      {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </div>
  );
}
