import type { Eingelesen } from "./bestand.ts";
import { buildAssignment, connectorByHand, linkAssignment } from "./hinzufuegen.ts";
import type { Ergebnis } from "./hinzufuegen.ts";
import { ERLAUBNISSE } from "./nachrichten.ts";
import type { Bestand, ClaudeModell, ClientMessage, Erlaubnis, HakenArt, JeArt, Optionen, ServerMessage, Vorgaben } from "./nachrichten.ts";
import type { ModellListe } from "./openrouter.ts";
import type { Gespeichert } from "./vorgaben.ts";
import type { Faehigkeiten, OptionResult, SendResult, SessionInfo, SettingResult } from "./sitzungen.ts";
import type { GespeicherteOptionen } from "./sitzungsoptionen.ts";
import type { Projekt } from "./nachrichten.ts";

export const INVENTORY_CACHE_MS = 60_000;
export const FALLBACK_STYLES: readonly string[] = ["default", "Proactive", "Concise", "Explanatory", "Learning"];
export const FALLBACK_MODELS: readonly ClaudeModell[] = [
  { wert: "default", text: "Standard" },
  { wert: "opus", text: "Opus" },
  { wert: "opus[1m]", text: "Opus mit 1 Mio. Kontext" },
  { wert: "sonnet", text: "Sonnet" },
  { wert: "sonnet[1m]", text: "Sonnet mit 1 Mio. Kontext" },
  { wert: "haiku", text: "Haiku" },
  { wert: "opusplan", text: "Opus im Planmodus, sonst Sonnet" },
];
export const NOT_SET_UP = "OpenRouter ist nicht eingerichtet";
export const CHECK_TITLE = "Link-Prüfung";
const AUTO_EFFORT = "auto";

interface Hinzugefuegt extends Ergebnis {
  readonly einrichtung: string | null;
}

export type OptionsMessage = Extract<
  ClientMessage,
  { typ: "bestand_holen" | "optionen_holen" | "projekte_holen" | "sitzung_umbenennen" | "haken" | "favorit" | "sitzung_einstellung" | "vorgaben" | "neu" | "hinzufuegen" }
>;

export interface Antwort {
  readonly an: "geraet" | "alle";
  readonly nachricht: ServerMessage;
}

export class OptionsFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionsFehler";
  }
}

export interface DienstSitzungen {
  list(): SessionInfo[];
  create(folder?: string, wahl?: Partial<GespeicherteOptionen>): Promise<SessionInfo>;
  send(id: string, text: string, mayRestart?: boolean): SendResult;
  rename(id: string, titel: string): Promise<OptionResult>;
  tick(id: string, art: HakenArt, kennung: string, an: boolean, basis: readonly string[]): Promise<OptionResult>;
  setSetting(id: string, schluessel: "erlaubnis" | "ausgabestil" | "schnell", wert: string | boolean): Promise<SettingResult>;
  capabilities(): Faehigkeiten | null;
}

export interface DienstTeile {
  readonly sitzungen: DienstSitzungen;
  readonly bestand: () => Promise<Eingelesen>;
  readonly vorgaben: { read(): Promise<Gespeichert>; setDefaults(werte: Vorgaben): Promise<void>; setFavourite(art: HakenArt, kennung: string, an: boolean): Promise<void> };
  readonly projekte: { list(): Promise<Projekt[]>; remember(ordner: string, zuletzt: number): Promise<void> };
  readonly openrouter: { list(): Promise<ModellListe> };
  readonly standardErlaubnis: () => Promise<Erlaubnis>;
  readonly linkGesperrt: string | null;
  readonly einbinden: (art: HakenArt, kennung: string, bestand: Eingelesen) => Promise<Ergebnis>;
  readonly ordnerPruefen: (ordner: string) => Promise<string>;
  readonly vergessen: () => void;
  readonly jetzt: () => number;
  readonly log: (text: string) => void;
}

function kennungenOf(bestand: Eingelesen, art: HakenArt): string[] {
  if (art === "skill") return bestand.skills.map((skill) => skill.kennung);
  if (art === "plugin") return bestand.plugins.map((plugin) => plugin.kennung);
  return bestand.konnektoren.filter((konnektor) => konnektor.jeSitzungSchaltbar).map((konnektor) => konnektor.kennung);
}

function activePlugins(bestand: Eingelesen): string[] {
  return bestand.plugins.filter((plugin) => plugin.aktivGlobal).map((plugin) => plugin.kennung);
}

const REFUSALS: Readonly<Record<Exclude<(OptionResult | SendResult | SettingResult)["kind"], "ok">, string>> = {
  unbekannt: "Unbekannte Sitzung.",
  beendet: "Diese Sitzung ist beendet.",
  gesperrt: "Der Erlaubnismodus einer Prüfsitzung ist fest.",
};

function rejected(result: OptionResult | SendResult | SettingResult): void {
  if (result.kind !== "ok") throw new OptionsFehler(REFUSALS[result.kind]);
}

export class Optionsdienst {
  readonly #teile: DienstTeile;

  constructor(teile: DienstTeile) {
    this.#teile = teile;
  }

  async handle(message: OptionsMessage): Promise<Antwort[]> {
    switch (message.typ) {
      case "bestand_holen":
        return [{ an: "geraet", nachricht: await this.bestand() }];
      case "optionen_holen":
        return [{ an: "geraet", nachricht: await this.optionen() }];
      case "projekte_holen":
        await this.#rememberRunning();
        return [{ an: "geraet", nachricht: { typ: "projekte", liste: await this.#teile.projekte.list() } }];
      case "vorgaben":
        await this.#teile.vorgaben.setDefaults(await this.#checkedDefaults(message.werte));
        return [{ an: "alle", nachricht: await this.optionen() }];
      case "favorit":
        await this.#favourite(message.art, message.kennung, message.an);
        return [{ an: "alle", nachricht: await this.bestand() }];
      default:
        return this.#sessionChange(message);
    }
  }

  async bestand(): Promise<ServerMessage> {
    const [read, stored] = await Promise.all([this.#teile.bestand(), this.#teile.vorgaben.read()]);
    for (const problem of read.probleme) this.#teile.log(problem);
    const { skills, plugins, konnektoren, bibliothek } = read;
    const bestand: Bestand = { skills, plugins, konnektoren, bibliothek, favoriten: stored.favoriten };
    return { typ: "bestand", ...bestand };
  }

  async optionen(): Promise<ServerMessage> {
    const [stored, openrouter] = await Promise.all([this.#teile.vorgaben.read(), this.#teile.openrouter.list()]);
    const faehig = this.#teile.sitzungen.capabilities();
    const optionen: Optionen = {
      erlaubnis: [...ERLAUBNISSE],
      ausgabestile: faehig?.ausgabestile ?? FALLBACK_STYLES,
      modelle: { claude: faehig?.modelle ?? FALLBACK_MODELS, ...openrouter },
      vorgaben: stored.vorgaben ?? (await this.#firstDefaults()),
      linkGesperrt: this.#teile.linkGesperrt,
    };
    return { typ: "optionen", ...optionen };
  }

  async #firstDefaults(): Promise<Vorgaben> {
    const bestand = await this.#teile.bestand();
    const konnektoren = kennungenOf(bestand, "konnektor");
    const erlaubnis = await this.#teile.standardErlaubnis();
    return { modell: "default", aufwand: AUTO_EFFORT, ordner: null, ausgabestil: null, erlaubnis, skills: [], plugins: activePlugins(bestand), konnektoren };
  }

  async #favourite(art: HakenArt, kennung: string, an: boolean): Promise<void> {
    const bestand = await this.#teile.bestand();
    const known = art === "konnektor" ? bestand.konnektoren.map((konnektor) => konnektor.kennung) : kennungenOf(bestand, art);
    if (an && !known.includes(kennung)) throw new OptionsFehler(`Unbekannt: ${kennung}`);
    await this.#teile.vorgaben.setFavourite(art, kennung, an);
  }

  #allowedModels(): readonly string[] {
    return (this.#teile.sitzungen.capabilities()?.modelle ?? FALLBACK_MODELS).map((model) => model.wert);
  }

  async #checkedDefaults(werte: Vorgaben): Promise<Vorgaben> {
    const bestand = await this.#teile.bestand();
    if (!this.#allowedModels().includes(werte.modell)) throw new OptionsFehler(`Unbekanntes Modell: ${werte.modell}`);
    if (werte.ausgabestil !== null && !(this.#teile.sitzungen.capabilities()?.ausgabestile ?? FALLBACK_STYLES).includes(werte.ausgabestil)) throw new OptionsFehler(`Unbekannter Ausgabestil: ${werte.ausgabestil}`);
    const kinds: [HakenArt, keyof JeArt<string>][] = [["skill", "skills"], ["plugin", "plugins"], ["konnektor", "konnektoren"]];
    for (const [art, key] of kinds) {
      const unknown = werte[key].find((kennung) => !kennungenOf(bestand, art).includes(kennung));
      if (unknown !== undefined) throw new OptionsFehler(`Unbekannt: ${unknown}`);
    }
    return werte.ordner === null ? werte : { ...werte, ordner: await this.#teile.ordnerPruefen(werte.ordner) };
  }

  async #sessionChange(message: Exclude<OptionsMessage, { typ: "bestand_holen" | "optionen_holen" | "projekte_holen" | "vorgaben" | "favorit" }>): Promise<Antwort[]> {
    const { sitzungen } = this.#teile;
    switch (message.typ) {
      case "sitzung_umbenennen":
        rejected(await sitzungen.rename(message.sitzung, message.titel));
        return [];
      case "haken":
        await this.#tick(message.sitzung, message.art, message.kennung, message.an);
        return [];
      case "sitzung_einstellung":
        await this.#setting(message);
        return [];
      case "neu":
        await this.#create(message);
        return [];
      case "hinzufuegen":
        return this.#add(message);
    }
  }

  async #tick(sitzung: string, art: HakenArt, kennung: string, an: boolean): Promise<void> {
    const bestand = await this.#teile.bestand();
    if (!kennungenOf(bestand, art).includes(kennung)) throw new OptionsFehler(`Unbekannt oder nicht je Sitzung schaltbar: ${kennung}`);
    if (art === "skill" && bestand.skills.some((skill) => skill.kennung === kennung && skill.immerAktiv)) throw new OptionsFehler(`${kennung} ist immer aktiv und lässt sich je Sitzung nicht schalten.`);
    rejected(await this.#teile.sitzungen.tick(sitzung, art, kennung, an, art === "plugin" ? activePlugins(bestand) : []));
  }

  async #setting(message: Extract<OptionsMessage, { typ: "sitzung_einstellung" }>): Promise<void> {
    if (message.schluessel === "ausgabestil" && !(this.#teile.sitzungen.capabilities()?.ausgabestile ?? FALLBACK_STYLES).includes(message.wert)) {
      throw new OptionsFehler(`Unbekannter Ausgabestil: ${message.wert}`);
    }
    rejected(await this.#teile.sitzungen.setSetting(message.sitzung, message.schluessel, message.wert));
  }

  async #choice(message: Extract<OptionsMessage, { typ: "neu" }>, vorgaben: Vorgaben | null, bestand: Eingelesen): Promise<Partial<GespeicherteOptionen>> {
    const fromDefaults: Partial<GespeicherteOptionen> =
      vorgaben === null
        ? {}
        : {
            skills: vorgaben.skills,
            plugins: vorgaben.plugins,
            konnektorenAus: kennungenOf(bestand, "konnektor").filter((kennung) => !vorgaben.konnektoren.includes(kennung)),
            erlaubnis: vorgaben.erlaubnis,
            ausgabestil: vorgaben.ausgabestil,
            modell: vorgaben.modell,
          };
    if (message.anbieter !== "openrouter") {
      if (message.modell !== undefined && !this.#allowedModels().includes(message.modell)) throw new OptionsFehler(`Unbekanntes Modell: ${message.modell}`);
      return message.modell === undefined ? fromDefaults : { ...fromDefaults, modell: message.modell };
    }
    const { openrouter } = await this.#teile.openrouter.list();
    if (openrouter === null) throw new OptionsFehler(NOT_SET_UP);
    if (message.modell === undefined || !openrouter.some((model) => model.id === message.modell)) throw new OptionsFehler("Dieses OpenRouter-Modell steht nicht in der Liste.");
    return { ...fromDefaults, anbieter: "openrouter", modell: message.modell, schnell: false };
  }

  async #inventoryOrEmpty(): Promise<Eingelesen> {
    try {
      return await this.#teile.bestand();
    } catch (error: unknown) {
      this.#teile.log(`the inventory could not be read, the session starts without it: ${error instanceof Error ? error.message : String(error)}`);
      return { skills: [], plugins: [], konnektoren: [], bibliothek: { skills: [], plugins: [], konnektoren: [] }, bibliotheksOrte: new Map(), konnektorTexte: new Map(), probleme: [] };
    }
  }

  async #rememberRunning(): Promise<void> {
    const running = new Set(this.#teile.sitzungen.list().filter((sitzung) => sitzung.prozess === "laeuft").map((sitzung) => sitzung.ordner));
    for (const ordner of running) await this.#remember(ordner);
  }

  async #remember(ordner: string): Promise<void> {
    try {
      await this.#teile.projekte.remember(ordner, this.#teile.jetzt());
    } catch (error: unknown) {
      this.#teile.log(`the folder ${ordner} could not be noted as a recent project: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async #create(message: Extract<OptionsMessage, { typ: "neu" }>): Promise<void> {
    const [stored, bestand] = await Promise.all([this.#teile.vorgaben.read(), this.#inventoryOrEmpty()]);
    const wahl = await this.#choice(message, stored.vorgaben, bestand);
    const folder = message.ordner ?? stored.vorgaben?.ordner ?? undefined;
    const created = await this.#teile.sitzungen.create(folder, wahl);
    await this.#remember(created.ordner);
    const aufwand = stored.vorgaben?.aufwand ?? AUTO_EFFORT;
    if (aufwand !== AUTO_EFFORT) this.#teile.sitzungen.send(created.id, `/effort ${aufwand}`);
  }

  async #add(message: Extract<OptionsMessage, { typ: "hinzufuegen" }>): Promise<Antwort[]> {
    const { art, weg, wert, sitzung } = message;
    const result = await this.#addResult(art, weg, wert, sitzung);
    const answer: Antwort = { an: "geraet", nachricht: { typ: "hinzugefuegt", art, weg, ok: result.ok, text: result.text, einrichtung: result.einrichtung } };
    if (!result.ok || weg !== "bibliothek") return [answer];
    this.#teile.vergessen();
    return [answer, { an: "alle", nachricht: await this.bestand() }];
  }

  async #fromLibrary(art: HakenArt, wert: string): Promise<Hinzugefuegt> {
    const bestand = await this.#teile.bestand();
    const offers = art === "skill" ? bestand.bibliothek.skills : art === "plugin" ? bestand.bibliothek.plugins : bestand.bibliothek.konnektoren;
    if (!offers.some((offer) => offer.kennung === wert)) return { ok: false, text: `${wert} steht nicht in der Bibliothek.`, einrichtung: null };
    if (art === "konnektor") return { ok: true, text: connectorByHand(wert).text, einrichtung: bestand.konnektorTexte.get(wert) ?? null };
    return { ...(await this.#teile.einbinden(art, wert, bestand)), einrichtung: null };
  }

  async #checkLink(art: HakenArt, link: string, sitzung: string): Promise<Hinzugefuegt> {
    if (this.#teile.linkGesperrt !== null) return { ok: false, text: this.#teile.linkGesperrt, einrichtung: null };
    const origin = this.#teile.sitzungen.list().find((entry) => entry.id === sitzung);
    if (origin === undefined) throw new OptionsFehler("Unbekannte Sitzung.");
    const check = await this.#teile.sitzungen.create(origin.ordner, { pruefung: true, erlaubnis: "default", anbieter: "abo", titel: CHECK_TITLE });
    rejected(this.#teile.sitzungen.send(check.id, linkAssignment(art, link)));
    return { ok: true, text: "Eine eigene Prüfsitzung prüft den Link; jede Handlung kommt als Erlaubnisfrage, das Urteil als Frage im Chat.", einrichtung: null };
  }

  async #addResult(art: HakenArt, weg: "bibliothek" | "link" | "neu", wert: string, sitzung: string | null): Promise<Hinzugefuegt> {
    if (weg === "bibliothek") return this.#fromLibrary(art, wert);
    if (sitzung === null) return { ok: false, text: "Dafür muss eine Sitzung gewählt sein.", einrichtung: null };
    if (weg === "link") return this.#checkLink(art, wert, sitzung);
    rejected(this.#teile.sitzungen.send(sitzung, buildAssignment(art, wert)));
    return { ok: true, text: "Die Sitzung baut den Wunsch nach dem Skill-Bauplan.", einrichtung: null };
  }
}
