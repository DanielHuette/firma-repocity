import { useState } from "preact/hooks";
import { LAENGSTER_BAUAUFTRAG, LAENGSTER_LINK, bauauftragLesen, hinzufuegen, linkLesen, type Angebot, type Bestand, type HakenArt, type Hinzugefuegt, type Weg } from "./bestand";
import type { HakenFensterArt } from "./HakenFenster";
import type { ClientNachricht } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

const WEG_TEXT: Readonly<Record<Weg, string>> = { bibliothek: "Aus der Bibliothek", link: "Link aus dem Netz", neu: "Neu bauen lassen" };
const ART_TEXT: Readonly<Record<HakenArt, string>> = { skill: "Skill", plugin: "Plugin", konnektor: "Konnektor" };
const BIBLIOTHEK_FELD: Readonly<Record<HakenArt, keyof Bestand["bibliothek"]>> = { skill: "skills", plugin: "plugins", konnektor: "konnektoren" };

function Bibliothek({ angebote, art, sitzung, gesperrt, schicken }: { angebote: readonly Angebot[]; art: HakenArt; sitzung: string | null; gesperrt: boolean; schicken: (nachricht: ClientNachricht) => void }) {
  const [frage, setFrage] = useState<Angebot | null>(null);
  if (angebote.length === 0) return <p class="kz-leer">In der Bibliothek liegt kein {ART_TEXT[art]}, der noch nicht eingebunden ist.</p>;
  return (
    <ul class="kz-liste">
      {angebote.map((angebot) => (
        <li key={angebot.kennung} class="kz-angebot">
          <span class="kz-liste__name">{angebot.name}</span>
          {angebot.beschreibung !== "" && <span class="kz-klein">{angebot.beschreibung}</span>}
          {angebot.braeuchteGeheimnis && <span class="kz-klein kz-angebot__geheimnis">Braucht einen Schlüssel: Den trägst du selbst ein; die Einrichtung sagt dir, wo.</span>}
          {art === "konnektor" ? (
            <button type="button" class="kz-btn" disabled={gesperrt} onClick={() => { schicken(hinzufuegen(art, "bibliothek", angebot.kennung, sitzung)); }}>Einrichtung zeigen</button>
          ) : frage?.kennung === angebot.kennung ? (
            <span class="kz-row" role="group" aria-label={`${angebot.name} einbinden bestätigen`}>
              <span class="kz-klein">{angebot.name} dauerhaft einbinden?</span>
              <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt} onClick={() => { schicken(hinzufuegen(art, "bibliothek", angebot.kennung, sitzung)); setFrage(null); }}>Ja, einbinden</button>
              <button type="button" class="kz-btn" onClick={() => { setFrage(null); }}>Nein</button>
            </span>
          ) : <button type="button" class="kz-btn" disabled={gesperrt} onClick={() => { setFrage(angebot); }}>Einbinden …</button>}
        </li>
      ))}
    </ul>
  );
}

function Eingabeweg({ weg, art, sitzung, gesperrt, schicken }: { weg: "link" | "neu"; art: HakenArt; sitzung: string | null; gesperrt: boolean; schicken: (nachricht: ClientNachricht) => void }) {
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState("");
  const abschicken = (ereignis: Event) => {
    ereignis.preventDefault();
    const gelesen = weg === "link" ? linkLesen(text) : bauauftragLesen(text);
    if (gelesen.kind === "fehler") { setFehler(gelesen.text); return; }
    setFehler("");
    schicken(hinzufuegen(art, weg, "link" in gelesen ? gelesen.link : gelesen.auftrag, sitzung));
    setText("");
  };
  const erklaerung = weg === "link"
    ? `Claude prüft den fremden ${ART_TEXT[art]} in einer eigenen Sitzung; jede Handlung fragt dich vorher. Das Urteil kommt als Frage-Karte; eingezogen wird erst nach deinem Klick auf „Einziehen“.`
    : `Claude baut den ${ART_TEXT[art]} in der gewählten Sitzung nach dem Skill-Bauplan. Du siehst jeden Schritt im Chat.`;
  return (
    <form class="kz-einstellung" onSubmit={abschicken}>
      <p class="kz-klein">{erklaerung}</p>
      {weg === "link" ? (
        <label class="kz-feld">Adresse (https)<input value={text} maxLength={LAENGSTER_LINK + 100} inputMode="url" placeholder="https://github.com/…" onInput={(ereignis) => { setText(ereignis.currentTarget.value); }} /></label>
      ) : (
        <label class="kz-feld">Was soll er können?<textarea class="kz-feld__text" value={text} rows={3} maxLength={LAENGSTER_BAUAUFTRAG + 100} onInput={(ereignis) => { setText(ereignis.currentTarget.value); }} /></label>
      )}
      <button type="submit" class="kz-btn kz-btn--go" disabled={gesperrt || text.trim() === ""}>{weg === "link" ? "Prüfen lassen" : "Bauen lassen"}</button>
      {fehler !== "" && <p class="kz-fehler" role="alert">{fehler}</p>}
    </form>
  );
}

function Segmente<T extends string>({ beschriftung, werte, texte, wert, onWahl }: {
  beschriftung: string; werte: readonly T[]; texte: Readonly<Record<T, string>>; wert: T; onWahl: (wert: T) => void;
}) {
  return (
    <div class="kz-segment" role="radiogroup" aria-label={beschriftung}>
      {werte.map((eintrag) => <button key={eintrag} type="button" role="radio" aria-checked={eintrag === wert} class="kz-segment__knopf" onClick={() => { onWahl(eintrag); }}>{texte[eintrag]}</button>)}
    </div>
  );
}

const WEGE_REIHE: readonly Weg[] = ["bibliothek", "link", "neu"];

function Antwort({ antwort }: { antwort: Hinzugefuegt | null }) {
  if (antwort === null) return <p class="kz-leer" role="status">Gesendet. Die Antwort der Brücke erscheint hier.</p>;
  return (
    <>
      <p class={antwort.ok ? "kz-plus__ok" : antwort.einrichtung !== null ? "kz-plus__hinweis" : "kz-fehler"} role="status">{antwort.text}</p>
      {antwort.einrichtung !== null && <pre class="kz-werkzeug__text">{antwort.einrichtung}</pre>}
    </>
  );
}

export interface HinzufuegenProps {
  readonly fensterArt: HakenFensterArt;
  readonly bestand: Bestand | null;
  readonly antwort: Hinzugefuegt | null;
  readonly sitzung: string | null;
  readonly linkGesperrt: string | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
}

export function Hinzufuegen({ fensterArt, bestand, antwort, sitzung, linkGesperrt, steuernd, senden }: HinzufuegenProps) {
  const arten: readonly HakenArt[] = fensterArt === "skills" ? ["skill", "plugin"] : ["konnektor"];
  const [art, setArt] = useState<HakenArt>(arten[0] ?? "skill");
  const [weg, setWeg] = useState<Weg>("bibliothek");
  const [fehler, setFehler] = useState(false);
  const [vorher, setVorher] = useState<{ readonly antwort: Hinzugefuegt | null } | null>(null);
  const schicken = (nachricht: ClientNachricht) => {
    const ok = senden(nachricht);
    setFehler(!ok);
    setVorher(ok ? { antwort } : null);
  };
  const linkZu = weg === "link" ? linkGesperrt : null;
  const gesperrt = !steuernd || (weg !== "bibliothek" && sitzung === null) || linkZu !== null;
  const gesendet = vorher !== null;
  const passendeAntwort = gesendet && antwort !== null && antwort !== vorher.antwort && antwort.art === art && antwort.weg === weg ? antwort : null;
  return (
    <section class="kz-plus" aria-label="Hinzufügen">
      {arten.length > 1 && <Segmente beschriftung="Was hinzufügen" werte={arten} texte={ART_TEXT} wert={art} onWahl={setArt} />}
      <Segmente beschriftung="Woher" werte={WEGE_REIHE} texte={WEG_TEXT} wert={weg} onWahl={setWeg} />
      {!steuernd && <p class="kz-klein">Hinzufügen kann nur das steuernde Gerät.</p>}
      {steuernd && weg !== "bibliothek" && sitzung === null && <p class="kz-klein" role="status">Erst eine Sitzung wählen: Claude erledigt das in der gewählten Sitzung.</p>}
      {linkZu !== null && <p class="kz-klein kz-warnung" role="status">Der Weg „Link“ ist gesperrt: {linkZu}</p>}
      {weg === "bibliothek"
        ? (bestand === null ? <p class="kz-leer" role="status">Lädt die Bibliothek …</p> : <Bibliothek angebote={bestand.bibliothek[BIBLIOTHEK_FELD[art]]} art={art} sitzung={sitzung} gesperrt={gesperrt} schicken={schicken} />)
        : <Eingabeweg key={`${weg}-${art}`} weg={weg} art={art} sitzung={sitzung} gesperrt={gesperrt} schicken={schicken} />}
      {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
      {gesendet && <Antwort antwort={passendeAntwort} />}
    </section>
  );
}
