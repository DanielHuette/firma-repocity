const NEWLINE = 0x0a;

export interface ZeilenRueckrufe {
  readonly zeile: (text: string) => void;
  readonly zuLang: (bytes: number) => void;
}

export class ZeilenLeser {
  readonly #grenze: number;
  readonly #rueckrufe: ZeilenRueckrufe;
  #stuecke: Buffer[] = [];
  #bytes = 0;
  #verworfen = 0;

  constructor(grenze: number, rueckrufe: ZeilenRueckrufe) {
    this.#grenze = grenze;
    this.#rueckrufe = rueckrufe;
  }

  schreiben(stueck: Buffer): void {
    let rest = stueck;
    for (let ende = rest.indexOf(NEWLINE); ende !== -1; ende = rest.indexOf(NEWLINE)) {
      this.#anhaengen(rest.subarray(0, ende));
      this.#abschliessen();
      rest = rest.subarray(ende + 1);
    }
    this.#anhaengen(rest);
  }

  ende(): void {
    if (this.#bytes > 0 || this.#verworfen > 0) this.#abschliessen();
  }

  #anhaengen(teil: Buffer): void {
    if (teil.length === 0) return;
    if (this.#verworfen > 0 || this.#bytes + teil.length > this.#grenze) {
      this.#verworfen += this.#bytes + teil.length;
      this.#stuecke = [];
      this.#bytes = 0;
      return;
    }
    this.#stuecke.push(teil);
    this.#bytes += teil.length;
  }

  #abschliessen(): void {
    if (this.#verworfen > 0) this.#rueckrufe.zuLang(this.#verworfen);
    else if (this.#bytes > 0) this.#rueckrufe.zeile(Buffer.concat(this.#stuecke).toString("utf8"));
    this.#stuecke = [];
    this.#bytes = 0;
    this.#verworfen = 0;
  }
}
