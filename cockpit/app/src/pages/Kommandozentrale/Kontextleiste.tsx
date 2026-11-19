import { kontextAnzeige, type KontextAnzeige } from "./anzeige";
import type { SitzungsZustand } from "./verbindung";

function Balken({ anzeige }: { anzeige: Extract<KontextAnzeige, { kind: "wert" }> }) {
  return (
    <>
      <div
        class="kz-track"
        role="meter"
        aria-label="Kontext belegt"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={anzeige.prozent}
        style={{ "--p": `${String(anzeige.prozent)}%`, "--gi": anzeige.leuchten }}
      >
        <div class="kz-fill" />
        <div class="kz-glow" />
      </div>
      <span class="kz-pct" style={{ color: anzeige.farbe, textShadow: anzeige.schein }}>{anzeige.text}</span>
    </>
  );
}

export const SEIT_UPDATE = "keine Daten seit Update";

export function Kontextleiste({ sitzung, keineDaten }: { sitzung: SitzungsZustand | null; keineDaten: boolean }) {
  const anzeige = sitzung === null || keineDaten ? { kind: "keine_daten" as const } : kontextAnzeige(sitzung.kontextProzent, sitzung.kontextVeraltet);
  return (
    <div class="kz-ctx">
      <span class="kz-ctx__lbl">Kontext</span>
      {anzeige.kind === "wert" ? <Balken anzeige={anzeige} /> : (
        <>
          <div class="kz-track kz-track--leer" aria-hidden="true" />
          <span class="kz-pct kz-pct--leer">{keineDaten ? SEIT_UPDATE : "keine Daten"}</span>
        </>
      )}
    </div>
  );
}
