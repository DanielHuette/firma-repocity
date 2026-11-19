import { useState } from "preact/hooks";
import type { Projekt } from "./bestand";
import { zuletztText } from "./ordnung";
import { useMinute } from "./useJetzt";
import { neueSitzung } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

function Statusfenster({ projekt, id }: { projekt: Projekt; id: string }) {
  const { status } = projekt;
  return (
    <div class="kz-projekt__status" id={id} role="tooltip">
      <strong class="kz-projekt__statuskopf">{projekt.name}</strong>
      <span class="kz-klein kz-projekt__pfad">{projekt.ordner}</span>
      {status === null ? <p class="kz-leer">Kein Projektstatus in diesem Ordner.</p> : (
        <>
          {status.phasen.length > 0 && (
            <table class="kz-projekt__phasen">
              <thead><tr><th scope="col">Phase</th><th scope="col">Status</th><th scope="col">Datum</th></tr></thead>
              <tbody>{status.phasen.map((phase) => (
                <tr key={phase.phase} class={`kz-projekt__phase kz-projekt__phase--${phase.status.replace(/[^a-z]/gi, "").toLowerCase()}`}>
                  <td>{phase.phase}</td><td>{phase.status}</td><td>{phase.datum}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {status.letzteEntscheidung !== null && <p class="kz-projekt__entscheidung"><span class="kz-klein">Letzte Entscheidung</span>{status.letzteEntscheidung}</p>}
        </>
      )}
    </div>
  );
}

interface ProjektZeileProps {
  readonly projekt: Projekt;
  readonly offen: boolean;
  readonly jetzt: number;
  readonly gesperrt: boolean;
  readonly onZeigen: (zeigen: boolean) => void;
  readonly onStarten: () => void;
}

function ProjektZeile({ projekt, offen, jetzt, gesperrt, onZeigen, onStarten }: ProjektZeileProps) {
  const [tippen, setTippen] = useState(false);
  const statusId = `kz-projekt-${projekt.ordner.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const klick = () => {
    if (tippen && !offen) { onZeigen(true); return; }
    onStarten();
  };
  return (
    <li class={offen ? "kz-projekt kz-projekt--offen" : "kz-projekt"} onMouseEnter={() => { onZeigen(true); }} onMouseLeave={() => { onZeigen(false); }}>
      <button type="button" class="kz-projekt__knopf" disabled={gesperrt} aria-describedby={offen ? statusId : undefined}
        title={gesperrt ? "Neue Sitzungen startet nur das steuernde Gerät" : `Neue Sitzung in ${projekt.ordner}`}
        onPointerDown={(ereignis) => { setTippen(ereignis.pointerType === "touch"); }} onFocus={() => { onZeigen(true); }} onBlur={() => { onZeigen(false); }} onClick={klick}>
        <span class="kz-projekt__name">{projekt.name}</span>
        <span class="kz-klein">{zuletztText(projekt.zuletzt, jetzt)}</span>
        {projekt.status !== null && <span class="kz-tag">{projekt.status.phasen.find((phase) => phase.status !== "fertig")?.phase ?? "fertig"}</span>}
      </button>
      {offen && <Statusfenster projekt={projekt} id={statusId} />}
      {offen && tippen && (
        <button type="button" class="kz-btn kz-btn--go kz-projekt__start" disabled={gesperrt} onClick={onStarten}>Neue Sitzung hier starten</button>
      )}
    </li>
  );
}

export interface ProjekteProps {
  readonly projekte: readonly Projekt[] | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly onGestartet: () => void;
}

export function Projekte({ projekte, steuernd, senden, onGestartet }: ProjekteProps) {
  const jetzt = useMinute();
  const [offen, setOffen] = useState<string | null>(null);
  const [fehler, setFehler] = useState(false);
  const starten = (ordner: string) => {
    const ok = senden(neueSitzung(ordner));
    setFehler(!ok);
    if (ok) { setOffen(null); onGestartet(); }
  };
  return (
    <section class="kz-panel kz-projekte" aria-labelledby="kz-projekte-titel">
      <h2 class="kz-ph" id="kz-projekte-titel">Letzte Projekte</h2>
      <div class="kz-pb">
        {projekte === null && <p class="kz-leer" role="status">Lädt die letzten Arbeitsordner …</p>}
        {projekte?.length === 0 && <p class="kz-leer">Noch keine Arbeitsordner. Sobald du Sitzungen startest, stehen die letzten vier hier.</p>}
        {projekte !== null && projekte.length > 0 && (
          <ul class="kz-projekt-liste">
            {projekte.map((projekt) => (
              <ProjektZeile key={projekt.ordner} projekt={projekt} offen={offen === projekt.ordner} jetzt={jetzt} gesperrt={!steuernd}
                onZeigen={(zeigen) => { setOffen(zeigen ? projekt.ordner : (alt) => (alt === projekt.ordner ? null : alt)); }} onStarten={() => { starten(projekt.ordner); }} />
            ))}
          </ul>
        )}
        {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
      </div>
    </section>
  );
}
