import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODELS_CACHE_FILE,
  FAILURE_PAUSE_MS,
  NOT_SET_UP,
  OPENROUTER_BASE,
  OpenRouterError,
  OpenRouterModelle,
  REDACTED,
  REFRESH_MS,
  modelsOf,
  readOpenRouterKey,
  redact,
  withProvider,
} from "../src/openrouter.ts";

const KEY = "sk-or-v1-0123456789abcdef0123";
let root: string;
let server: Server | null = null;
let calls = 0;

function model(id: string, prompt = "0.000003", completion = "0.000015", context_length: unknown = 200_000): Record<string, unknown> {
  return { id, name: `Name ${id}`, context_length, pricing: { prompt, completion } };
}

async function standIn(status: number, body: unknown): Promise<string> {
  server = createServer((_request, response) => {
    calls += 1;
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}/api/v1/models`;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "openrouter-"));
  calls = 0;
});

afterEach(async () => {
  const running = server;
  server = null;
  if (running !== null) await new Promise((resolve) => running.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe("modelsOf", () => {
  it("converts prices per token into US dollars per million tokens", () => {
    expect(modelsOf({ data: [model("anthropic/claude-sonnet-4.5")] })).toEqual([
      { id: "anthropic/claude-sonnet-4.5", name: "Name anthropic/claude-sonnet-4.5", preisEinProMio: 3, preisAusProMio: 15, kontextFenster: 200_000 },
    ]);
  });

  it.each([
    ["a negative price", model("openrouter/auto", "-1")],
    ["a price that is a number", model("a/b", 0.1 as unknown as string)],
    ["a price in exponent form", model("a/b", "3e-6")],
    ["an id with a space", model("a b")],
    ["no name", { ...model("a/b"), name: "" }],
  ])("leaves out a model with %s", (_case, entry) => {
    expect(modelsOf({ data: [entry] })).toEqual([]);
  });

  it("keeps a free model", () => {
    expect(modelsOf({ data: [model("x/frei", "0", "0")] })[0]).toMatchObject({ preisEinProMio: 0, preisAusProMio: 0 });
  });

  it("shows no context window when OpenRouter names none", () => {
    expect(modelsOf({ data: [model("a/b", "0.000001", "0.000002", null)] })[0]?.kontextFenster).toBeNull();
  });

  it("lists every id once", () => {
    expect(modelsOf({ data: [model("a/b"), model("a/b", "0.000001")] })).toHaveLength(1);
  });
});

describe("readOpenRouterKey", () => {
  it("reads the key without surrounding space", async () => {
    const file = path.join(root, "schluessel");
    await writeFile(file, `${KEY}\n`, { mode: 0o600 });
    expect(await readOpenRouterKey(file)).toBe(KEY);
  });

  it.each([
    ["a line among others", `# Schlüssel\nANDERES=wert\nOPENROUTER_API_KEY=${KEY}\nNOCH=1\n`],
    ["Windows line ends and spaces", `ANDERES=x\r\nOPENROUTER_API_KEY = ${KEY}  \r\n`],
    ["double quotes", `OPENROUTER_API_KEY="${KEY}"`],
    ["single quotes and export", `export OPENROUTER_API_KEY='${KEY}'`],
    ["the last of two lines", `OPENROUTER_API_KEY=alt-0123456789abcdef\nOPENROUTER_API_KEY=${KEY}`],
  ])("reads the key from an .env file with %s", async (_case, content) => {
    const file = path.join(root, ".env");
    await writeFile(file, content, { mode: 0o600 });
    expect(await readOpenRouterKey(file)).toBe(KEY);
  });

  it("names the missing line when an .env file holds no OpenRouter key", async () => {
    const file = path.join(root, ".env");
    await writeFile(file, "ANDERES=wert\nOPENROUTER_KEY=nicht-der-name-0123\n", { mode: 0o600 });
    await expect(readOpenRouterKey(file)).rejects.toThrow("OPENROUTER_API_KEY=");
  });

  it("refuses an invalid key in an .env file", async () => {
    const file = path.join(root, ".env");
    await writeFile(file, "OPENROUTER_API_KEY=sk-or", { mode: 0o600 });
    await expect(readOpenRouterKey(file)).rejects.toThrow("keinen gültigen Schlüssel");
  });

  it("says it is not set up without key file", async () => {
    await expect(readOpenRouterKey(null)).rejects.toThrow(NOT_SET_UP);
  });

  it.each([["missing", null], ["empty", ""], ["holding a short key", "sk-or"], ["holding a key with a space", "sk-or-v1 0123456789abcdef"]])("refuses a key file that is %s", async (_case, content) => {
    const file = path.join(root, "schluessel");
    if (content !== null) await writeFile(file, content, { mode: 0o600 });
    await expect(readOpenRouterKey(file)).rejects.toThrow(OpenRouterError);
  });

  it.runIf(process.platform !== "win32")("refuses a key file others can read", async () => {
    const file = path.join(root, "schluessel");
    await writeFile(file, KEY);
    await chmod(file, 0o644);
    await expect(readOpenRouterKey(file)).rejects.toThrow("chmod 600");
  });
});

describe("withProvider", () => {
  const environment = { PATH: "/bin", ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_AUTH_TOKEN: "alt", ANTHROPIC_API_KEY: "sk-ant" };

  it("removes the provider variables for subscription sessions", () => {
    expect(withProvider(environment, "abo", KEY)).toEqual({ PATH: "/bin" });
  });

  it("sets OpenRouter with the key and an empty Anthropic key", () => {
    expect(withProvider(environment, "openrouter", KEY)).toEqual({ PATH: "/bin", ANTHROPIC_BASE_URL: OPENROUTER_BASE, ANTHROPIC_AUTH_TOKEN: KEY, ANTHROPIC_API_KEY: "" });
  });

  it("refuses OpenRouter without key", () => {
    expect(() => withProvider(environment, "openrouter", null)).toThrow(NOT_SET_UP);
  });
});

describe("redact", () => {
  it("blacks out every copy of the key", () => {
    expect(redact(`a ${KEY} b ${KEY}`, KEY)).toBe(`a ${REDACTED} b ${REDACTED}`);
  });

  it("leaves text alone without key", () => {
    expect(redact("a", null)).toBe("a");
  });
});

describe("OpenRouterModelle", () => {
  it("fetches nothing and names the reason when no key file is set", async () => {
    const adresse = await standIn(200, { data: [model("a/b")] });
    expect(await new OpenRouterModelle({ schluesselDatei: null, datenordner: root, adresse }).list()).toEqual({ openrouter: null, openrouterGrund: NOT_SET_UP });
    expect(calls).toBe(0);
  });

  it("fetches the list once a day and keeps it in the data folder", async () => {
    const adresse = await standIn(200, { data: [model("a/b")] });
    let jetzt = 1_000_000;
    const options = { schluesselDatei: path.join(root, "k"), datenordner: root, adresse, jetzt: () => jetzt };
    expect((await new OpenRouterModelle(options).list()).openrouter).toHaveLength(1);
    jetzt += REFRESH_MS - 1;
    await new OpenRouterModelle(options).list();
    expect(calls).toBe(1);
    jetzt += 1;
    await new OpenRouterModelle(options).list();
    expect(calls).toBe(2);
    expect(JSON.parse(await readFile(path.join(root, MODELS_CACHE_FILE), "utf8"))).toMatchObject({ abgerufen: jetzt });
  });

  it("names the reason when OpenRouter answers with an error", async () => {
    const adresse = await standIn(503, {});
    expect(await new OpenRouterModelle({ schluesselDatei: path.join(root, "k"), datenordner: root, adresse }).list()).toEqual({
      openrouter: null,
      openrouterGrund: "Abruf der OpenRouter-Modelle gescheitert: OpenRouter antwortet mit 503",
    });
  });

  it("names the reason when no model with tools comes back", async () => {
    const adresse = await standIn(200, { data: [] });
    expect((await new OpenRouterModelle({ schluesselDatei: path.join(root, "k"), datenordner: root, adresse }).list()).openrouterGrund).toContain("kein Modell");
  });

  it("names the reason when OpenRouter cannot be reached", async () => {
    const adresse = await standIn(200, {});
    await new Promise((resolve) => server?.close(resolve));
    server = null;
    expect((await new OpenRouterModelle({ schluesselDatei: path.join(root, "k"), datenordner: root, adresse }).list()).openrouterGrund).toMatch(/^Abruf der OpenRouter-Modelle gescheitert: /);
  });
});

describe("OpenRouterModelle when the cache cannot be written", () => {
  it("keeps the fetched list in memory, says so and serves it again without asking OpenRouter", async () => {
    let status = 200;
    server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(status === 200 ? { data: [model("a/b")] } : {}));
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const adresse = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/models`;
    const keinOrdner = path.join(root, "datei-statt-ordner");
    await writeFile(keinOrdner, "x");
    let jetzt = 1_000_000;
    const liste = new OpenRouterModelle({ schluesselDatei: path.join(root, "k"), datenordner: keinOrdner, adresse, jetzt: () => jetzt });
    const erste = await liste.list();
    expect(erste.openrouter).toHaveLength(1);
    expect(erste.openrouterGrund).toMatch(/^Liste geholt, aber nicht zwischengespeichert: /);
    expect((await liste.list()).openrouter).toHaveLength(1);
    expect(calls).toBe(1);
    status = 503;
    jetzt += REFRESH_MS;
    const danach = await liste.list();
    expect(danach.openrouter).toHaveLength(1);
    expect(danach.openrouterGrund).toContain("es gilt die letzte Liste");
  });
});

describe("OpenRouterModelle after a failure", () => {
  it("keeps the last list with the reason and does not ask again for ten minutes", async () => {
    let status = 200;
    server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(status === 200 ? { data: [model("a/b")] } : {}));
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const adresse = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/models`;
    let jetzt = 1_000_000;
    const liste = new OpenRouterModelle({ schluesselDatei: path.join(root, "k"), datenordner: root, adresse, jetzt: () => jetzt });
    await liste.list();
    status = 503;
    jetzt += REFRESH_MS;
    const failed = await liste.list();
    expect(failed.openrouter).toHaveLength(1);
    expect(failed.openrouterGrund).toContain("es gilt die letzte Liste");
    status = 200;
    jetzt += FAILURE_PAUSE_MS - 1;
    expect((await liste.list()).openrouterGrund).toContain("gescheitert");
    expect(calls).toBe(2);
    jetzt += 1;
    expect(await liste.list()).toMatchObject({ openrouterGrund: null });
    expect(calls).toBe(3);
  });
});
