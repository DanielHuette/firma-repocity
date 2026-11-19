import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SECRET_HEADER, senderAllowed } from "./meldungen.ts";

export const STOP_PATH = "/stop";

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

export function stopStatus(request: IncomingMessage, secret: string): number {
  const { remoteAddress, localPort } = request.socket;
  if (!senderAllowed(remoteAddress, localPort, header(request, "host"))) return 403;
  if (request.method !== "POST") return 405;
  if (!timingSafeEqual(digest(header(request, SECRET_HEADER) ?? ""), digest(secret))) return 401;
  return 202;
}

export function handleStop(request: IncomingMessage, response: ServerResponse, secret: string, onStop: () => void): void {
  const status = stopStatus(request, secret);
  request.resume();
  response.writeHead(status).end();
  if (status === 202) onStop();
}
