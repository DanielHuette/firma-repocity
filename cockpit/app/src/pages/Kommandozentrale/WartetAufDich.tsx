import { useEffect, useState } from "preact/hooks";
import { immerAnbieten, regelZeilen } from "./anzeige";
import { SEIT_UPDATE } from "./Kontextleiste";
import { keineDaten } from "./menuepunkte";
import { BESTAETIGUNG_MS, antwortLage, type Gesendet } from "./rueckmeldung";
import type { Meldung } from "./useBruecke";
import { verdichten, type AssistenzAntwort, type Entscheidung, type Frage, type Hinweis, type SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

const ENTSCHEIDUNG_TEXT: Record<Entscheidung, string> = { ja: "Ja", nein: "Nein", immer: "Immer" };

export interface WartetAufDichProps {
  readonly sitzungen: readonly SitzungsZustand[];
  readonly meldungen: readonly Meldung[];
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly verwerfen: (nummer: number) => void;
  readonly onZumChat: (sitzung: string) => void;
  readonly onReparieren: (sitzung: string, auftrag: string) => void;
  readonly assistenz: readonly AssistenzAntwort[];
  readonly assistenzWeg: (frage: string) => void;
}

function agentName(sitzung: SitzungsZustand, frage: Frage): string {
  return sitzung.agenten.find((agent) => agent.id === frage.agent)?.name ?? frage.agent;
}

function Regel({ frage, gesperrt, onBestaetigen, onZurueck }: { frage: Frage; gesperrt: boolean; onBestaetigen: () => void; onZurueck: () => void }) {
  return (
    <div class="kz-regel">
      <p class="kz-klein">Diese Regel wird gespeichert:</p>
      <ul>{regelZeilen(frage.regelBeiImmer ?? []).map((zeile) => <li key={zeile}>{zeile}</li>)}</ul>
      <div class="kz-row">
        <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt} onClick={onBestaetigen}>Regel bestätigen</button>
        <button type="button" class="kz-btn" onClick={onZurueck}>Zurück</button>
      </div>
    </div>
  );
}

function Knoepfe({ frage, immer, gesperrt, antworten, onImmer }: { frage: Frage; immer: boolean; gesperrt: boolean; antworten: (entscheidung: Entscheidung) => void; onImmer: () => void }) {
  return (
    <div class="kz-row">
      <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt} onClick={() => { antworten("ja"); }}>Ja</button>
      <button type="button" class="kz-btn" disabled={gesperrt} onClick={() => { antworten("nein"); }}>Nein</button>
      {immer && frage.regelBeiImmer !== null && <button type="button" class="kz-btn" disabled={gesperrt} onClick={onImmer}>Immer …</button>}
    </div>
  );
}

function useAntwort(frage: Frage, meldungen: readonly Meldung[], senden: Senden) {
  const [gesendet, setGesendet] = useState<(Gesendet & { readonly entscheidung: Entscheidung }) | null>(null);
  const [fehlgeschlagen, setFehlgeschlagen] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    if (gesendet === null) return;
    const zeitgeber = setTimeout(() => { setJetzt(Date.now()); }, BESTAETIGUNG_MS);
    return () => { clearTimeout(zeitgeber); };
  }, [gesendet]);
  const antworten = (entscheidung: Entscheidung) => {
    const ok = senden({ typ: "antwort", frage: frage.id, entscheidung });
    setFehlgeschlagen(!ok);
    const um = Date.now();
    setJetzt(um);
    if (ok) setGesendet({ um, letzteMeldung: meldungen.reduce((hoechste, meldung) => Math.max(hoechste, meldung.nummer), 0), entscheidung });
  };
  return { gesendet, lage: antwortLage(gesendet, meldungen, jetzt), fehlgeschlagen, antworten };
}

function AntwortStand({ entscheidung, lage }: { entscheidung: Entscheidung | null; lage: ReturnType<typeof antwortLage> }) {
  switch (lage.kind) {
    case "frei":
      return null;
    case "gesendet":
      return entscheidung === null ? null : <p class="kz-klein" role="status">„{ENTSCHEIDUNG_TEXT[entscheidung]}“ gesendet, warte auf Claude Code …</p>;
    case "abgelehnt":
      return <p class="kz-fehler" role="alert">Die Brücke hat die Antwort abgelehnt: {lage.text} Du kannst erneut antworten.</p>;
    case "unbestaetigt":
      return <p class="kz-fehler" role="alert">Nach 5 Sekunden wartet die Frage noch. Die Antwort ist wohl nicht angekommen; antworte erneut.</p>;
  }
}

interface FrageProps {
  readonly sitzung: SitzungsZustand;
  readonly frage: Frage;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly meldungen: readonly Meldung[];
}

function FrageKarte({ sitzung, frage, steuernd, senden, meldungen }: FrageProps) {
  const [immer, setImmer] = useState(false);
  const { gesendet, lage, fehlgeschlagen, antworten } = useAntwort(frage, meldungen, senden);
  const gesperrt = !steuernd || lage.kind === "gesendet";
  return (
    <article class="kz-card kz-card--hot" aria-label={`Frage von ${agentName(sitzung, frage)}`}>
      <div class="kz-who"><span class="kz-dot kz-dot--wartet" aria-hidden="true" />{agentName(sitzung, frage)}<small>{sitzung.titel} · {frage.werkzeug}</small></div>
      <p class="kz-card__text">{frage.beschreibung}</p>
      {immer ? <Regel frage={frage} gesperrt={gesperrt} onBestaetigen={() => { antworten("immer"); }} onZurueck={() => { setImmer(false); }} />
        : <Knoepfe frage={frage} immer={immerAnbieten(sitzung, frage)} gesperrt={gesperrt} antworten={antworten} onImmer={() => { setImmer(true); }} />}
      <AntwortStand entscheidung={gesendet?.entscheidung ?? null} lage={lage} />
      {fehlgeschlagen && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </article>
  );
}

type Aktion = Extract<Hinweis, { art: "verdichten" | "selbsttest" }>;
type Karte = Exclude<Hinweis, { art: "keine_daten" }>;

interface HinweisProps {
  readonly sitzung: SitzungsZustand;
  readonly hinweis: Aktion;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly onSpaeter: () => void;
  readonly onReparieren: (sitzung: string, auftrag: string) => void;
}

function HinweisKnopf({ sitzung, hinweis, steuernd, senden, onSpaeter, onReparieren, onFehler }: HinweisProps & { onFehler: (fehlgeschlagen: boolean) => void }) {
  const ausloesen = () => {
    if (hinweis.art === "selbsttest") {
      onReparieren(sitzung.id, hinweis.auftrag);
      onSpaeter();
      return;
    }
    const ok = senden(verdichten(sitzung.id));
    onFehler(!ok);
    if (ok) onSpaeter();
  };
  return <button type="button" class="kz-btn kz-btn--go" disabled={!steuernd} onClick={ausloesen}>{hinweis.art === "verdichten" ? "Verdichten" : "Reparieren lassen"}</button>;
}

function HinweisKarte(props: HinweisProps) {
  const [fehlgeschlagen, setFehlgeschlagen] = useState(false);
  const { sitzung, hinweis, onSpaeter } = props;
  const selbsttest = hinweis.art === "selbsttest";
  return (
    <article class={selbsttest ? "kz-card kz-card--hot" : "kz-card"} aria-label={selbsttest ? "Hinweis des Selbsttests" : "Hinweis"}>
      <div class="kz-who"><span class={selbsttest ? "kz-dot kz-dot--wartet" : "kz-dot"} aria-hidden="true" />{selbsttest ? "Selbsttest" : "Hinweis"}<small>{sitzung.titel} · {selbsttest ? "nach Update" : "Kontext"}</small></div>
      <p class="kz-card__text">{selbsttest ? hinweis.text : hinweis.anzeige}</p>
      {selbsttest && <p class="kz-klein">Der Knopf schreibt den vorbereiteten Auftrag in dein Eingabefeld, ohne ihn abzuschicken.</p>}
      <div class="kz-row">
        <HinweisKnopf {...props} onFehler={setFehlgeschlagen} />
        <button type="button" class="kz-btn" onClick={onSpaeter}>Später</button>
      </div>
      {fehlgeschlagen && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </article>
  );
}

function ChatFrageKarte({ sitzung, text, onZumChat }: { sitzung: SitzungsZustand; text: string; onZumChat: (sitzung: string) => void }) {
  return (
    <article class="kz-card kz-card--hot" aria-label="Claude fragt im Chat">
      <div class="kz-who"><span class="kz-dot kz-dot--wartet" aria-hidden="true" />Claude fragt im Chat<small>{sitzung.titel}</small></div>
      <p class="kz-card__text">{text}</p>
      <div class="kz-row"><button type="button" class="kz-btn kz-btn--go" onClick={() => { onZumChat(sitzung.id); }}>Zum Chat</button></div>
    </article>
  );
}

function AssistenzKarte({ antwort, titel, onWeg }: { antwort: AssistenzAntwort; titel: string; onWeg: () => void }) {
  const was = antwort.beschreibung === "" ? antwort.werkzeug : `${antwort.werkzeug} · ${antwort.beschreibung}`;
  return (
    <article class="kz-card kz-card--assistenz" aria-label={`Antwort von ${antwort.name}`}>
      <div class="kz-who"><span class="kz-dot" aria-hidden="true" />{antwort.name} hat geantwortet · {titel}</div>
      <p class="kz-card__text"><strong>{antwort.entscheidung === "ja" ? "Ja" : "Nein"}</strong> · {was}</p>
      <div class="kz-row"><button type="button" class="kz-btn" onClick={onWeg}>Ausblenden</button></div>
    </article>
  );
}

function MeldungKarte({ meldung, onWeg }: { meldung: Meldung; onWeg: () => void }) {
  return (
    <article class="kz-card kz-card--meldung" aria-label="Meldung der Brücke">
      <div class="kz-who"><span class="kz-dot kz-dot--wartet" aria-hidden="true" />Meldung der Brücke</div>
      <p class="kz-card__text">{meldung.text}</p>
      <div class="kz-row"><button type="button" class="kz-btn" onClick={onWeg}>Ausblenden</button></div>
    </article>
  );
}

function hinweisSchluessel(sitzung: SitzungsZustand, hinweis: Karte): string {
  return `${sitzung.id}|${hinweis.art}|${hinweis.art === "verdichten" ? hinweis.anzeige : hinweis.text}`;
}

function karten(sitzungen: readonly SitzungsZustand[]): { sitzung: SitzungsZustand; hinweis: Karte; schluessel: string }[] {
  return sitzungen.flatMap((sitzung) => sitzung.hinweise.flatMap((hinweis) => (
    hinweis.art === "keine_daten" ? [] : [{ sitzung, hinweis, schluessel: hinweisSchluessel(sitzung, hinweis) }]
  )));
}

interface KartenProps {
  readonly eintrag: { readonly sitzung: SitzungsZustand; readonly hinweis: Karte; readonly schluessel: string };
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly onSpaeter: () => void;
  readonly onZumChat: (sitzung: string) => void;
  readonly onReparieren: (sitzung: string, auftrag: string) => void;
}

function HinweisEintrag({ eintrag, steuernd, senden, onSpaeter, onZumChat, onReparieren }: KartenProps) {
  const { sitzung, hinweis } = eintrag;
  if (hinweis.art === "terminal_frage") return <ChatFrageKarte sitzung={sitzung} text={hinweis.text} onZumChat={onZumChat} />;
  return <HinweisKarte sitzung={sitzung} hinweis={hinweis} steuernd={steuernd} senden={senden} onSpaeter={onSpaeter} onReparieren={onReparieren} />;
}

export function WartetAufDich({ sitzungen, meldungen, steuernd, senden, verwerfen, onZumChat, onReparieren, assistenz, assistenzWeg }: WartetAufDichProps) {
  const [spaeter, setSpaeter] = useState<ReadonlySet<string>>(new Set());
  const fragen = sitzungen.flatMap((sitzung) => sitzung.wartet.map((frage) => ({ sitzung, frage })));
  const hinweise = karten(sitzungen).filter((eintrag) => !spaeter.has(eintrag.schluessel));
  const ohneFragen = sitzungen.filter((sitzung) => keineDaten(sitzung, "fragen"));
  const leer = fragen.length + hinweise.length + meldungen.length + assistenz.length === 0;
  return (
    <section class="kz-panel kz-wartet" id="kz-wartet" aria-labelledby="kz-wartet-titel">
      <h2 class="kz-ph" id="kz-wartet-titel">Wartet auf dich<span class="kz-sp" /><span class="kz-badge">{fragen.length}</span></h2>
      <div class="kz-wait-list">
        {ohneFragen.map((sitzung) => <p key={sitzung.id} class="kz-seit-update" role="status">Fragen aus {sitzung.titel}: {SEIT_UPDATE}</p>)}
        {!steuernd && fragen.length > 0 && <p class="kz-klein">Antworten kann nur das steuernde Gerät.</p>}
        {fragen.map(({ sitzung, frage }) => <FrageKarte key={frage.id} sitzung={sitzung} frage={frage} steuernd={steuernd} senden={senden} meldungen={meldungen} />)}
        {assistenz.map((antwort) => (
          <AssistenzKarte key={antwort.frage} antwort={antwort} titel={sitzungen.find((sitzung) => sitzung.id === antwort.sitzung)?.titel ?? "beendete Sitzung"}
            onWeg={() => { assistenzWeg(antwort.frage); }} />
        ))}
        {hinweise.map((eintrag) => (
          <HinweisEintrag key={eintrag.schluessel} eintrag={eintrag} steuernd={steuernd} senden={senden} onZumChat={onZumChat} onReparieren={onReparieren}
            onSpaeter={() => { setSpaeter(new Set([...spaeter, eintrag.schluessel])); }} />
        ))}
        {meldungen.map((meldung) => <MeldungKarte key={meldung.nummer} meldung={meldung} onWeg={() => { verwerfen(meldung.nummer); }} />)}
        {leer && <p class="kz-leer">Gerade wartet nichts auf dich.</p>}
      </div>
    </section>
  );
}
