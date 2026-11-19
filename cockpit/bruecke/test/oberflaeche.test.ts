import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InterfaceFolderError, interfaceRoot, securityHeaders, serveInterface } from "../src/oberflaeche.ts";

const INDEX = "<!doctype html><title>Cockpit</title>";
const SCRIPT = "console.info('app');";
const SECRET = "GEHEIMER-INHALT-AUSSERHALB";

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

let folder: string;
let dist: string;
let server: Server;
let port: number;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-oberflaeche-"));
  dist = path.join(folder, "dist");
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await mkdir(path.join(folder, "draussen"));
  await writeFile(path.join(dist, "index.html"), INDEX);
  await writeFile(path.join(dist, "assets", "app-abc123.js"), SCRIPT);
  await writeFile(path.join(dist, "assets", "app-abc123.css"), "body{}");
  await writeFile(path.join(dist, "sw.js"), "self;");
  await writeFile(path.join(dist, "manifest.webmanifest"), "{}");
  await writeFile(path.join(dist, "unbekannt.xyz"), "x");
  await writeFile(path.join(folder, "geheim.txt"), SECRET);
  await writeFile(path.join(folder, "draussen", "geheim.txt"), SECRET);
  const root = await interfaceRoot(dist);
  server = createServer((incoming, outgoing) => {
    serveInterface(root, incoming, outgoing, securityHeaders(8787)).catch((error: unknown) => {
      if (outgoing.headersSent) outgoing.destroy();
      else outgoing.writeHead(599).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => {
    resolve();
  }));
  await rm(folder, { recursive: true, force: true });
});

function get(rawPath: string, method = "GET"): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path: rawPath, method }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => (text += chunk));
      incoming.on("end", () => {
        resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text });
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("securityHeaders", () => {
  it("follows app/public/_headers and adds the WebSocket of the bridge to connect-src", () => {
    expect(securityHeaders(8787)).toEqual({
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; " +
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws://127.0.0.1:8787; worker-src 'self'; " +
        "manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(self), geolocation=()",
    });
  });
});

describe("interfaceRoot", () => {
  it("names the missing folder and how to build it", async () => {
    const missing = path.join(folder, "fehlt");
    const failure = interfaceRoot(missing);
    await expect(failure).rejects.toThrow(InterfaceFolderError);
    await expect(failure).rejects.toThrow(missing);
    await expect(failure).rejects.toThrow("npm run build");
  });

  it("rejects a folder without index.html", async () => {
    await expect(interfaceRoot(path.join(folder, "draussen"))).rejects.toThrow("index.html");
  });
});

describe("serveInterface", () => {
  it("serves index.html for / with the security headers and without CORS", async () => {
    const reply = await get("/");
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(INDEX);
    expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("no-cache");
    expect(reply.headers["x-content-type-options"]).toBe("nosniff");
    expect(reply.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(Object.keys(reply.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
  });

  it.each([
    ["/assets/app-abc123.js", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"],
    ["/assets/app-abc123.css", "text/css; charset=utf-8", "public, max-age=31536000, immutable"],
    ["/sw.js", "text/javascript; charset=utf-8", "no-cache"],
    ["/manifest.webmanifest", "application/manifest+json", "no-cache"],
    ["/unbekannt.xyz", "application/octet-stream", "no-cache"],
  ])("serves %s as %s with caching %s", async (file, type, caching) => {
    const reply = await get(file);
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe(type);
    expect(reply.headers["cache-control"]).toBe(caching);
  });

  it("answers HEAD with the headers and no body", async () => {
    const reply = await get("/assets/app-abc123.js", "HEAD");
    expect(reply.status).toBe(200);
    expect(reply.headers["content-length"]).toBe(String(Buffer.byteLength(SCRIPT)));
    expect(reply.body).toBe("");
  });

  it.each(["/kommandozentrale", "/kommandozentrale/", "/einstellungen/geraete"])("serves index.html for the page path %s", async (page) => {
    const reply = await get(page);
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(INDEX);
  });

  it.each(["/fehlt.js", "/assets/fehlt-123.css", "/bild.png"])("answers 404 for the missing file %s instead of index.html", async (file) => {
    const reply = await get(file);
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain(INDEX);
  });

  it("lists no folder", async () => {
    const reply = await get("/assets/");
    expect(reply.body).not.toContain("app-abc123");
  });

  it.each([
    "/../geheim.txt",
    "/assets/../../geheim.txt",
    "/%2e%2e/geheim.txt",
    "/..%2fgeheim.txt",
    "/assets/..%2f..%2fgeheim.txt",
    "/..%5cgeheim.txt",
    "/assets/..%5c..%5cgeheim.txt",
    "/%2e%2e%5cgeheim.txt",
    "/C:%5cWindows%5cwin.ini",
    "/geheim.txt%00.js",
    "/index.html::$DATA",
  ])("never serves a file outside the folder for %s", async (rawPath) => {
    const reply = await get(rawPath);
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain(SECRET);
  });

  it("answers 400 for a path that is not valid percent encoding", async () => {
    expect((await get("/%E0%A4%A.js")).status).toBe(400);
  });

  it("does not follow a link inside the folder that points outside", async () => {
    await symlink(path.join(folder, "draussen"), path.join(dist, "raus"), "junction");
    const reply = await get("/raus/geheim.txt");
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain(SECRET);
  });
});

describe("a client that leaves during a download", () => {
  it("is no error for the bridge", async () => {
    const big = path.join(dist, "assets", "gross.js");
    await writeFile(big, "x".repeat(32 * 1024 * 1024));
    const failures: unknown[] = [];
    const root = await interfaceRoot(dist);
    const leaving = createServer((incoming, outgoing) => {
      serveInterface(root, incoming, outgoing, securityHeaders(8787)).catch((error: unknown) => failures.push(error));
    });
    await new Promise<void>((resolve) => leaving.listen(0, "127.0.0.1", resolve));
    const { port: leavingPort } = leaving.address() as AddressInfo;
    await new Promise<void>((resolve) => {
      const outgoing = request({ host: "127.0.0.1", port: leavingPort, path: "/assets/gross.js" }, (incoming) => {
        incoming.once("data", () => {
          incoming.destroy();
          setTimeout(resolve, 300);
        });
      });
      outgoing.end();
    });
    leaving.closeAllConnections();
    await new Promise<void>((resolve) => leaving.close(() => {
      resolve();
    }));
    expect(failures).toEqual([]);
  });
});
