import { Component, type ComponentChildren } from "preact";

interface AuffangenZustand {
  readonly fehler: string | null;
}

export class Auffangen extends Component<{ children: ComponentChildren }, AuffangenZustand> {
  override state: AuffangenZustand = { fehler: null };

  override componentDidCatch(fehler: unknown): void {
    this.setState({ fehler: fehler instanceof Error ? fehler.message : String(fehler) });
  }

  override render() {
    if (this.state.fehler === null) return this.props.children;
    return (
      <main class="kz-absturz" role="alert">
        <h1>Die Kommandozentrale ist abgestürzt</h1>
        <p>{this.state.fehler}</p>
        <p>Lade die Seite neu. Deine Sitzungen laufen in der Brücke weiter.</p>
        <button type="button" onClick={() => { window.location.reload(); }}>Seite neu laden</button>
      </main>
    );
  }
}
