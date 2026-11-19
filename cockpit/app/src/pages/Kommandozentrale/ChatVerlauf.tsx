import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { amEnde, ansageText, verschachteln, type Eintrag } from "./chat";
import { EintragAnsicht, type EintragRahmen } from "./ChatEintrag";
import type { KartenRahmen } from "./ChatKarten";
import { CHAT_FLAECHE, reiterKennung } from "./kennungen";

export interface ChatVerlaufProps {
  readonly eintraege: readonly Eintrag[];
  readonly arbeitet: boolean;
  readonly rahmen: KartenRahmen;
}

function useFolgen(ort: { readonly current: HTMLDivElement | null }, eintraege: readonly Eintrag[]) {
  const [folgen, setFolgen] = useState(true);
  useLayoutEffect(() => {
    const verlauf = ort.current;
    if (folgen && verlauf !== null) verlauf.scrollTop = verlauf.scrollHeight;
  }, [ort, eintraege, folgen]);
  const pruefen = () => { if (ort.current !== null) setFolgen(amEnde(ort.current)); };
  const zumEnde = () => {
    ort.current?.scrollTo({ top: ort.current.scrollHeight });
    setFolgen(true);
  };
  return { folgen, pruefen, zumEnde };
}

function useAnsage(eintraege: readonly Eintrag[], arbeitet: boolean): string {
  const [ansage, setAnsage] = useState("");
  const erster = useRef(true);
  const letzte = eintraege.at(-1);
  const wartetAufDich = letzte?.art === "frage" || letzte?.art === "plan";
  const aktuell = useRef(eintraege);
  aktuell.current = eintraege;
  useEffect(() => {
    if (erster.current) {
      erster.current = false;
      return;
    }
    if (!arbeitet || wartetAufDich) setAnsage(ansageText(aktuell.current));
  }, [arbeitet, wartetAufDich, letzte?.id]);
  return ansage;
}

function laufenderText(eintraege: readonly Eintrag[], arbeitet: boolean): string | null {
  const letzte = eintraege.at(-1);
  return arbeitet && letzte?.art === "claude" ? letzte.id : null;
}

export function ChatVerlauf({ eintraege, arbeitet, rahmen }: ChatVerlaufProps) {
  const ort = useRef<HTMLDivElement>(null);
  const { folgen, pruefen, zumEnde } = useFolgen(ort, eintraege);
  const ansage = useAnsage(eintraege, arbeitet);
  const baum = useMemo(() => verschachteln(eintraege), [eintraege]);
  const eintragRahmen: EintragRahmen = { ...rahmen, laufend: laufenderText(eintraege, arbeitet) };
  return (
    <div class="kz-chat" id={CHAT_FLAECHE} role="tabpanel" aria-labelledby={reiterKennung(rahmen.sitzung)}>
      <div class="kz-chat__verlauf" ref={ort} onScroll={pruefen} role="log" aria-live="off" aria-label="Verlauf der Sitzung" tabIndex={0}>
        <div class="kz-chat__spalte">
          {baum.map((knoten) => <EintragAnsicht key={knoten.eintrag.id} knoten={knoten} rahmen={eintragRahmen} />)}
          {eintraege.length === 0 && <p class="kz-leer kz-chat__leer">Noch keine Nachrichten. Schreib unten, was Claude tun soll.</p>}
        </div>
      </div>
      {!folgen && <button type="button" class="kz-btn kz-chat__neueste" onClick={zumEnde}>↓ Neueste</button>}
      <p class="kz-nur-leser" role="status" aria-live="polite">{ansage}</p>
    </div>
  );
}
