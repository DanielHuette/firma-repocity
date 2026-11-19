import { useState } from "preact/hooks";
import { neueSitzungMit, type FremdModell, type Optionen } from "./bestand";
import { modellSetzen } from "./menuepunkte";
import { KOSTENFALLE, kostenfalle, preisText } from "./ordnung";
import type { ClientNachricht, SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

const OPENROUTER_HINWEIS = "kostet OpenRouter-Guthaben; Vault-Inhalte dieser Sitzung gehen an den gewählten Anbieter";
const ZAHL = new Intl.NumberFormat("de-DE");

export interface ModellFensterProps {
  readonly optionen: Optionen | null;
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly onFertig: () => void;
}

function ClaudeListe({ optionen, sitzung, steuernd, schicken }: Omit<ModellFensterProps, "senden" | "onFertig"> & { schicken: (nachricht: ClientNachricht) => void }) {
  const gesperrt = !steuernd || sitzung === null || sitzung.anbieter === "openrouter";
  const jetzt = sitzung?.modell ?? null;
  return (
    <section class="kz-hk-gruppe" aria-labelledby="kz-modell-claude">
      <h3 class="kz-unterkopf" id="kz-modell-claude">Claude · über dein Abo</h3>
      <p class="kz-klein">Gilt für die gewählte Sitzung und geht als /model in den Chat. Jetzt: {jetzt ?? "unbekannt"}.</p>
      {sitzung === null && <p class="kz-klein">Erst eine Sitzung wählen.</p>}
      {sitzung?.anbieter === "openrouter" && <p class="kz-klein">Diese Sitzung läuft über OpenRouter; der Anbieter wechselt nicht mitten in der Sitzung.</p>}
      {sitzung?.erlaubnis === "plan" && <p class="kz-klein kz-warnung" role="status">Die Sitzung ist im Planmodus. Bei „haiku“ und „opusplan“ gilt: {KOSTENFALLE}</p>}
      {optionen === null ? <p class="kz-leer" role="status">Lädt die Modelle von der Brücke …</p> : (
        <ul class="kz-liste">{optionen.modelle.claude.map((modell) => (
          <li key={modell.wert}>
            <button type="button" class="kz-liste__knopf" disabled={gesperrt} aria-current={modell.wert === jetzt ? "true" : undefined}
              onClick={() => { if (sitzung !== null) schicken(modellSetzen(sitzung.id, modell.wert)); }}>
              <span class="kz-liste__name">{modell.text}</span>
              <span class="kz-klein">{modell.wert}{sitzung !== null && kostenfalle(modell.wert, sitzung.erlaubnis) ? " · im Planmodus teurer" : ""}</span>
            </button>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Bestaetigen({ modell, ordner, gesperrt, onStarten, onAbbrechen }: { modell: FremdModell; ordner: string; gesperrt: boolean; onStarten: () => void; onAbbrechen: () => void }) {
  return (
    <div class="kz-regel" role="group" aria-label={`Neue Sitzung mit ${modell.name}`}>
      <strong>Neue Sitzung mit diesem Modell: {modell.name}</strong>
      <p class="kz-klein">Modell-ID: <code>{modell.id}</code></p>
      <p class="kz-klein">Hinweis: {OPENROUTER_HINWEIS}.</p>
      <p class="kz-klein">Ordner: {ordner === "" ? "Vault (Vorgabe)" : ordner}</p>
      <span class="kz-row">
        <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt} onClick={onStarten}>Neue Sitzung starten</button>
        <button type="button" class="kz-btn" onClick={onAbbrechen}>Abbrechen</button>
      </span>
    </div>
  );
}

function FremdZeile({ modell, gewaehlt, gesperrt, onWahl }: { modell: FremdModell; gewaehlt: boolean; gesperrt: boolean; onWahl: () => void }) {
  return (
    <li>
      <button type="button" class="kz-liste__knopf kz-liste__knopf--zweizeilig" disabled={gesperrt} aria-pressed={gewaehlt} onClick={onWahl}>
        <span class="kz-liste__name">{modell.name}</span>
        <span class="kz-klein">{modell.id} · {preisText(modell.preisEinProMio, modell.preisAusProMio)}{modell.kontextFenster === null ? "" : ` · ${ZAHL.format(modell.kontextFenster)} Tokens Kontext`}</span>
      </button>
    </li>
  );
}

function FremdListe({ optionen, sitzung, steuernd, schicken }: Omit<ModellFensterProps, "senden" | "onFertig"> & { schicken: (nachricht: ClientNachricht) => void }) {
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState<FremdModell | null>(null);
  if (optionen === null) return null;
  const { openrouter, openrouterGrund } = optionen.modelle;
  const gesucht = suche.trim().toLowerCase();
  const ordner = sitzung?.ordner ?? "";
  return (
    <section class="kz-hk-gruppe" aria-labelledby="kz-modell-openrouter">
      <h3 class="kz-unterkopf" id="kz-modell-openrouter">OpenRouter · neue Sitzung</h3>
      <p class="kz-klein">Startet eine eigene Sitzung über OpenRouter. Sicher funktioniert nur der Anbieter Anthropic; andere Modelle können bei Werkzeugen scheitern. Abgerechnet wird je Nutzung über dein OpenRouter-Guthaben.</p>
      {openrouter === null ? <p class="kz-leer">OpenRouter ist nicht eingerichtet{openrouterGrund === null ? "." : `: ${openrouterGrund}`}</p> : (
        <>
          <label class="kz-feld">Modell suchen<input value={suche} onInput={(ereignis) => { setSuche(ereignis.currentTarget.value); }} placeholder="Name oder Kennung" /></label>
          {gewaehlt !== null && (
            <Bestaetigen modell={gewaehlt} ordner={ordner} gesperrt={!steuernd} onAbbrechen={() => { setGewaehlt(null); }}
              onStarten={() => { schicken(neueSitzungMit(ordner, "openrouter", gewaehlt.id)); setGewaehlt(null); }} />
          )}
          <ul class="kz-liste">{openrouter.filter((modell) => gesucht === "" || `${modell.name} ${modell.id}`.toLowerCase().includes(gesucht)).map((modell) => (
            <FremdZeile key={modell.id} modell={modell} gewaehlt={gewaehlt?.id === modell.id} gesperrt={!steuernd} onWahl={() => { setGewaehlt(modell); }} />
          ))}</ul>
        </>
      )}
    </section>
  );
}

export function ModellFenster({ optionen, sitzung, steuernd, senden, onFertig }: ModellFensterProps) {
  const [fehler, setFehler] = useState(false);
  const schicken = (nachricht: ClientNachricht) => {
    const ok = senden(nachricht);
    setFehler(!ok);
    if (ok) onFertig();
  };
  return (
    <div class="kz-fensterinhalt">
      {!steuernd && <p class="kz-klein">Das kann nur das steuernde Gerät.</p>}
      <ClaudeListe optionen={optionen} sitzung={sitzung} steuernd={steuernd} schicken={schicken} />
      <FremdListe optionen={optionen} sitzung={sitzung} steuernd={steuernd} schicken={schicken} />
      {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </div>
  );
}
