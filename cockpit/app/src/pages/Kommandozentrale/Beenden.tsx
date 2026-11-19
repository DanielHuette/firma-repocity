import { Mark } from "../../components/Logo";
import { Dialog } from "./Dialog";

export const BEENDEN_FRAGE = "Beendet die Kommandozentrale und alle laufenden Claude-Sitzungen. Laufende Arbeit wird unterbrochen.";
export const BEENDET_TEXT = "Neu starten über das Desktop-Symbol „Kommandozentrale“.";

export function BeendenDialog({ onBeenden, onAbbrechen }: { onBeenden: () => void; onAbbrechen: () => void }) {
  return (
    <Dialog titelId="kz-beenden-titel" onAbbrechen={onAbbrechen}>
      <div class="kz-dialog__inhalt">
        <h2 id="kz-beenden-titel">Zentrale beenden?</h2>
        <p>{BEENDEN_FRAGE}</p>
        <div class="kz-row">
          <button type="button" class="kz-btn kz-btn--stop" onClick={onBeenden}>Beenden</button>
          <button type="button" class="kz-btn" autoFocus onClick={onAbbrechen}>Abbrechen</button>
        </div>
      </div>
    </Dialog>
  );
}

export function ZentraleBeendet() {
  return (
    <Dialog titelId="kz-beendet-titel" onAbbrechen={null}>
      <div class="kz-dialog__inhalt">
        <div class="kz-brand kz-brand--gross"><Mark size={40} />REPOCITY</div>
        <h2 id="kz-beendet-titel">Kommandozentrale beendet</h2>
        <p role="status">{BEENDET_TEXT}</p>
      </div>
    </Dialog>
  );
}
