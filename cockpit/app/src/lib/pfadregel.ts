const KOMMANDOZENTRALE = "/kommandozentrale";

const COCKPIT_MANIFEST = "/manifest.webmanifest";
const KOMMANDOZENTRALE_MANIFEST = "/kommandozentrale.webmanifest";

export function istKommandozentrale(pfad: string): boolean {
  return pfad === KOMMANDOZENTRALE || pfad.startsWith(`${KOMMANDOZENTRALE}/`);
}

export function manifestFuer(pfad: string): string {
  return istKommandozentrale(pfad) ? KOMMANDOZENTRALE_MANIFEST : COCKPIT_MANIFEST;
}
