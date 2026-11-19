import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { isInside } from "./pfade.ts";
import { hasErrorCode } from "./private_datei.ts";

const INDEX_FILE = "index.html";
const ASSETS_FOLDER = "assets";
const NO_CACHE = "no-cache";
const IMMUTABLE = "public, max-age=31536000, immutable";
const UNKNOWN_TYPE = "application/octet-stream";
const FORBIDDEN_IN_SEGMENT = /[:\0]/;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export class InterfaceFolderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InterfaceFolderError";
  }
}

export function securityHeaders(port: number): Record<string, string> {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co ws://127.0.0.1:${String(port)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return {
    "content-security-policy": policy.join("; "),
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(self), geolocation=()",
  };
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

export async function interfaceRoot(folder: string): Promise<string> {
  const build = "build the interface with: npm ci && npm run build in the app folder";
  let real: string;
  try {
    real = await realpath(folder);
  } catch (error: unknown) {
    throw new InterfaceFolderError(`the interface folder ${folder} is missing; ${build}`, { cause: error });
  }
  if (!(await isFile(path.join(real, INDEX_FILE)))) {
    throw new InterfaceFolderError(`the interface folder ${folder} holds no ${INDEX_FILE}; ${build}`);
  }
  return real;
}

type Lookup = { kind: "datei"; file: string } | { kind: "fehlt"; pagePath: boolean } | { kind: "ungueltig" };

function segmentsOf(pathname: string): string[] | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error: unknown) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
  return decoded.split("/").filter((segment) => segment !== "");
}

function isSafeSegment(segment: string): boolean {
  return !FORBIDDEN_IN_SEGMENT.test(segment);
}

async function lookup(root: string, pathname: string): Promise<Lookup> {
  const segments = segmentsOf(pathname);
  if (segments === undefined) return { kind: "ungueltig" };
  const pagePath = !(segments.at(-1) ?? "").includes(".");
  if (!segments.every(isSafeSegment)) return { kind: "fehlt", pagePath: false };
  const file = path.join(root, ...(segments.length === 0 ? [INDEX_FILE] : segments));
  if (!isInside(root, file) || !(await isFile(file))) return { kind: "fehlt", pagePath };
  if (!isInside(root, await realpath(file))) return { kind: "fehlt", pagePath: false };
  return { kind: "datei", file };
}

function cachingOf(root: string, file: string): string {
  return path.relative(root, file).split(path.sep)[0] === ASSETS_FOLDER ? IMMUTABLE : NO_CACHE;
}

async function sendFile(
  root: string,
  file: string,
  request: IncomingMessage,
  response: ServerResponse,
  headers: OutgoingHttpHeaders,
): Promise<void> {
  const { size } = await stat(file);
  response.writeHead(200, {
    ...headers,
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? UNKNOWN_TYPE,
    "content-length": size,
    "cache-control": cachingOf(root, file),
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  try {
    await pipeline(createReadStream(file), response);
  } catch (error: unknown) {
    if (!hasErrorCode(error, "ERR_STREAM_PREMATURE_CLOSE")) throw error;
  }
}

export async function serveInterface(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
  headers: OutgoingHttpHeaders,
): Promise<void> {
  const found = await lookup(root, new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  if (found.kind === "datei") return sendFile(root, found.file, request, response, headers);
  if (found.kind === "fehlt" && found.pagePath) return sendFile(root, path.join(root, INDEX_FILE), request, response, headers);
  response.writeHead(found.kind === "ungueltig" ? 400 : 404, { ...headers, "cache-control": NO_CACHE }).end();
}
