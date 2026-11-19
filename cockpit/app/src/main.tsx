import { render } from "preact";
import { supabaseConfig } from "./api/config";
import { captureInstallPrompt } from "./hooks/install";
import { installPointerLight } from "./hooks/motion";
import { istKommandozentrale, manifestFuer } from "./lib/pfadregel";
import "./theme/app.css";

const root = document.getElementById("app");
if (root === null) throw new Error("Element #app is missing in index.html");

document.querySelector('link[rel="manifest"]')?.setAttribute("href", manifestFuer(window.location.pathname));
captureInstallPrompt();
installPointerLight();

function ConfigMissing() {
  return (
    <main class="signin">
      <div class="signin__card panel stack">
        <h1>Cockpit nicht eingerichtet</h1>
        <p class="muted">
          Beim Bauen fehlten VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY. Trag beide in Cloudflare Pages unter Einstellungen, Umgebungsvariablen ein und baue neu.
        </p>
      </div>
    </main>
  );
}

function LadenFehlgeschlagen({ grund }: { grund: unknown }) {
  return (
    <main class="signin">
      <div class="signin__card panel stack" role="alert">
        <h1>Seite nicht geladen</h1>
        <p class="muted">Ein Teil der App ließ sich nicht laden. Lade die Seite neu. ({grund instanceof Error ? grund.message : String(grund)})</p>
      </div>
    </main>
  );
}

function scheitern(ziel: HTMLElement): (grund: unknown) => void {
  return (grund) => { render(<LadenFehlgeschlagen grund={grund} />, ziel); };
}

if (istKommandozentrale(window.location.pathname)) {
  void Promise.all([import("./pages/Kommandozentrale/Kommandozentrale"), import("./pages/Kommandozentrale/Auffangen")]).then(([{ Kommandozentrale }, { Auffangen }]) => {
    render(<Auffangen><Kommandozentrale /></Auffangen>, root);
  }, scheitern(root));
} else if (supabaseConfig() === null) {
  render(<ConfigMissing />, root);
} else {
  void import("./App").then(({ App }) => {
    render(<App />, root);
  }, scheitern(root));
}
