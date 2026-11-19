import { Mark } from "../../components/Logo";
import { Dialog } from "./Dialog";
import { KEINE_BRUECKE } from "./zugang";

export function KeineBruecke() {
  return (
    <Dialog titelId="kz-keine-bruecke-titel" onAbbrechen={null}>
      <div class="kz-dialog__inhalt">
        <div class="kz-brand kz-brand--gross"><Mark size={40} />REPOCITY</div>
        <h2 id="kz-keine-bruecke-titel">Kommandozentrale nicht erreichbar</h2>
        <p role="alert">{KEINE_BRUECKE}</p>
        <a class="kz-btn" href="/">Zum Cockpit</a>
      </div>
    </Dialog>
  );
}
