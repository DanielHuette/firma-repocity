import { Dialog } from "./Dialog";
import type { Modus } from "./verbindung";

export function Geraet({ name, speicherOk, onWahl }: { name: string; speicherOk: boolean; onWahl: (modus: Modus) => void }) {
  return (
    <Dialog titelId="kz-geraet-titel" onAbbrechen={null}>
      <div class="kz-dialog__inhalt">
        <h2 id="kz-geraet-titel">Wie arbeitest du auf diesem Gerät?</h2>
        <p>Nur ein Gerät steuert die Sitzungen. Das andere sieht zu, bis es übernimmt. Dieses Gerät heißt „{name}“.</p>
        {!speicherOk && <p class="kz-fehler">Dieser Browser erlaubt kein Speichern. Name und Gerätekennung gelten nur bis zum Neuladen.</p>}
        <div class="kz-row">
          <button type="button" class="kz-btn kz-btn--go" autoFocus onClick={() => { onWahl("arbeiten"); }}>Hier arbeiten</button>
          <button type="button" class="kz-btn" onClick={() => { onWahl("zusehen"); }}>Nur zusehen</button>
        </div>
      </div>
    </Dialog>
  );
}
