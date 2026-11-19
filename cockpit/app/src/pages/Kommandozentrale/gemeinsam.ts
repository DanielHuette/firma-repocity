import type { ClientNachricht } from "./verbindung";

export type Senden = (nachricht: ClientNachricht) => boolean;

export const NICHT_GESENDET = "Nicht gesendet: Die Brücke ist gerade nicht verbunden.";
