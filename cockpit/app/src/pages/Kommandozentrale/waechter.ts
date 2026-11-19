export type Felder = Readonly<Record<string, unknown>>;

export function istFelder(wert: unknown): wert is Felder {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

export function istText(wert: unknown): wert is string {
  return typeof wert === "string";
}

export function istTextOderNull(wert: unknown): wert is string | null {
  return wert === null || typeof wert === "string";
}

export function istZahl(wert: unknown): wert is number {
  return typeof wert === "number" && Number.isFinite(wert);
}

export function istGanzzahl(wert: unknown): wert is number {
  return typeof wert === "number" && Number.isSafeInteger(wert);
}

export function istAus<T extends string>(werte: readonly T[], wert: unknown): wert is T {
  return typeof wert === "string" && (werte as readonly string[]).includes(wert);
}

export function liste<T>(wert: unknown, lesen: (eintrag: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(wert)) return undefined;
  const gelesen: T[] = [];
  for (const eintrag of wert as unknown[]) {
    const ergebnis = lesen(eintrag);
    if (ergebnis === undefined) return undefined;
    gelesen.push(ergebnis);
  }
  return gelesen;
}

export function gueltigeAus<T>(wert: unknown, lesen: (eintrag: unknown) => T | undefined): T[] | undefined {
  return Array.isArray(wert) ? (wert as unknown[]).flatMap((eintrag) => lesen(eintrag) ?? []) : undefined;
}
