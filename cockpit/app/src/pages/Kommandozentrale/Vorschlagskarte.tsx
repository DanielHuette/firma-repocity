import { useState } from "preact/hooks";
import type { Eintrag } from "./chat";
import { aufwandSetzen, modellSetzen } from "./menuepunkte";
import type { ClientNachricht, SitzungsZustand } from "./verbindung";
import { zeigeVorschlag } from "./vorschlag";

export interface VorschlagskarteProps {
  readonly sitzung: SitzungsZustand | null;
  readonly entwurf: string;
  readonly eintraege: readonly Eintrag[];
  readonly gesperrt: boolean;
  readonly schicken: (nachricht: ClientNachricht) => boolean;
}

export function Vorschlagskarte({ sitzung, entwurf, eintraege, gesperrt, schicken }: VorschlagskarteProps) {
  const [abgelehnt, setAbgelehnt] = useState<string | null>(null);
  if (sitzung === null || sitzung.anbieter === "openrouter") return null;
  const aufgabe = `${sitzung.id}|${String(eintraege.length)}`;
  const vorschlag = abgelehnt === aufgabe ? null : zeigeVorschlag(entwurf, eintraege, sitzung.modell, sitzung.aufwand);
  if (vorschlag === null) return null;
  const uebernehmen = () => {
    if (schicken(modellSetzen(sitzung.id, vorschlag.modell))) schicken(aufwandSetzen(sitzung.id, vorschlag.aufwand));
  };
  return (
    <div class="kz-vorschlag" role="status">
      <span class="kz-vorschlag__text">
        Vorschlag: <strong>{vorschlag.anzeige}</strong> <span class="kz-klein">– {vorschlag.grund}</span>
      </span>
      <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt} onClick={uebernehmen}>Übernehmen</button>
      <button type="button" class="kz-btn" onClick={() => { setAbgelehnt(aufgabe); }}>Nein danke</button>
    </div>
  );
}
