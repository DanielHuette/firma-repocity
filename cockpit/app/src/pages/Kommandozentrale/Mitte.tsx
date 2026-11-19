import type { Ref } from "preact";
import { useState } from "preact/hooks";
import { reiterStand } from "./anzeige";
import { ChatVerlauf } from "./ChatVerlauf";
import { Eingabe } from "./Eingabe";
import { CHAT_FLAECHE } from "./kennungen";
import { Kontextleiste } from "./Kontextleiste";
import { keineDaten } from "./menuepunkte";
import { kostenText } from "./ordnung";
import { fortsetzen } from "./verbindung";
import type { Bruecke } from "./useBruecke";
import type { SitzungsZustand } from "./verbindung";
import { type Senden } from "./gemeinsam";

const KEINE_EINTRAEGE: readonly never[] = [];

function BeendenKnopf({ sitzung, senden }: { sitzung: SitzungsZustand; senden: Senden }) {
  const [fragen, setFragen] = useState(false);
  if (!fragen) return <button type="button" class="kz-btn" onClick={() => { setFragen(true); }}>Beenden</button>;
  return (
    <span class="kz-row" role="group" aria-label="Beenden bestätigen">
      <span class="kz-klein">Sitzung „{sitzung.titel}“ beenden?</span>
      <button type="button" class="kz-btn kz-btn--go" onClick={() => { senden({ typ: "beenden", sitzung: sitzung.id }); setFragen(false); }}>Ja, beenden</button>
      <button type="button" class="kz-btn" onClick={() => { setFragen(false); }}>Nein</button>
    </span>
  );
}

function MitteKopf({ sitzung, steuernd, senden }: { sitzung: SitzungsZustand | null; steuernd: boolean; senden: Senden }) {
  if (sitzung === null) return <div class="kz-chead"><h2>Keine Sitzung</h2></div>;
  return (
    <div class="kz-chead">
      <span class={`kz-dot kz-dot--${reiterStand(sitzung.stand, sitzung.prozess)}`} aria-hidden="true" />
      <h2>{sitzung.titel}</h2>
      <span class="kz-sp" />
      {sitzung.neustartAusstehend && <span class="kz-chip kz-chip--hinweis" role="status">wird beim nächsten Schritt neu verbunden</span>}
      {sitzung.pausiert && <span class="kz-chip kz-chip--hinweis" role="status">pausiert</span>}
      {sitzung.pausiert && steuernd && <button type="button" class="kz-btn kz-btn--go" onClick={() => { senden(fortsetzen(sitzung.id)); }}>Fortsetzen (kostet OpenRouter-Guthaben)</button>}
      {sitzung.kostenUsd !== null && <span class="kz-chip" title="Schätzung von Claude Code, abgerechnet über dein OpenRouter-Guthaben">{kostenText(sitzung.kostenUsd)} · Schätzung von Claude Code</span>}
      <span class="kz-chip kz-chip--pfad" title={sitzung.ordner}>▤ {sitzung.ordner}</span>
      {steuernd && <BeendenKnopf key={sitzung.id} sitzung={sitzung} senden={senden} />}
    </div>
  );
}

function SitzungsHinweis({ sitzung }: { sitzung: SitzungsZustand | null }) {
  if (sitzung === null) return null;
  if (sitzung.hinweis !== null) return <p class="kz-ended" role="status">{sitzung.hinweis}</p>;
  if (sitzung.prozess === "beendet") return <p class="kz-ended" role="status">Claude Code ist in dieser Sitzung beendet.</p>;
  return null;
}

export interface MitteProps {
  readonly bruecke: Bruecke;
  readonly aktiv: string | null;
  readonly steuernd: boolean;
  readonly entwurf: string;
  readonly setEntwurf: (text: string) => void;
  readonly feld: Ref<HTMLTextAreaElement>;
}

export function Mitte({ bruecke, aktiv, steuernd, entwurf, setEntwurf, feld }: MitteProps) {
  const sitzung = bruecke.lage.sitzungen.find((eintrag) => eintrag.id === aktiv) ?? null;
  const rahmen = { sitzung: sitzung?.id ?? "", steuernd, senden: bruecke.senden, meldungen: bruecke.meldungen };
  return (
    <section class="kz-panel kz-center" aria-label="Sitzung">
      <MitteKopf sitzung={sitzung} steuernd={steuernd} senden={bruecke.senden} />
      <SitzungsHinweis sitzung={sitzung} />
      {sitzung === null
        ? <div class="kz-chat kz-chat--leer" id={CHAT_FLAECHE} role="tabpanel" aria-label="Chat"><p class="kz-leer">Noch keine Sitzung. Starte eine mit dem Plus oben.</p></div>
        : <ChatVerlauf key={sitzung.id} eintraege={bruecke.chats.get(sitzung.id) ?? KEINE_EINTRAEGE} arbeitet={sitzung.stand === "arbeitet"} rahmen={rahmen} />}
      <Kontextleiste sitzung={sitzung} keineDaten={keineDaten(sitzung, "kontext")} />
      <Eingabe sitzung={sitzung} steuernd={steuernd} senden={bruecke.senden} entwurf={entwurf} setEntwurf={setEntwurf} feld={feld} modelle={bruecke.menue.optionen?.modelle.claude ?? KEINE_EINTRAEGE}
        eintraege={sitzung === null ? KEINE_EINTRAEGE : (bruecke.chats.get(sitzung.id) ?? KEINE_EINTRAEGE)} />
    </section>
  );
}
